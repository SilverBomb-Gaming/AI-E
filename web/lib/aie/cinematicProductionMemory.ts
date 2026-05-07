import { constants, existsSync, readFileSync } from "node:fs";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRoot, resolveRepoRootSync } from "./repoContext";

const SECOND_BRAIN_DIR = path.join("data", "second_brain");
const PRODUCTION_MEMORY_FILE = "production_memory.json";
const DEFAULT_CREATED_AT = "2026-05-07T00:00:00.000Z";
const GOVERNED_LOW_RES_SANDBOX_DIR = path.join(".aie", "governed_low_res_frame_sandbox");

export type CostTier = "low" | "medium" | "high";

export type ProductionMemoryManagerSystem = {
  id:
    | "production-memory-manager"
    | "scene-graph-builder"
    | "shot-planner"
    | "trailer-cutscene-director"
    | "continuity-checker"
    | "asset-reuse-tracker"
    | "gameplay-cutscene-trigger-system"
    | "cinematic-prompt-compiler"
    | "cost-aware-iteration-system"
    | "cinematic-execution-sandbox"
    | "provider-routing-layer"
    | "shot-batch-orchestrator"
    | "generation-lifecycle-tracker"
    | "second-brain-obsidian-integration";
  title: string;
  status: "planned" | "foundation" | "active";
  summary: string;
};

export type CinematicCharacterProfile = {
  character_id: string;
  name: string;
  role: string;
  visual_signature: string[];
  emotional_range: string[];
  continuity_rules: string[];
};

export type CinematicEnvironmentProfile = {
  environment_id: string;
  name: string;
  mood: string;
  visual_markers: string[];
  lighting_rules: string[];
  props: string[];
};

export type CinematicStoryBeat = {
  beat_id: string;
  title: string;
  summary: string;
  emotional_goal: string;
  gameplay_trigger: string;
  continuity_dependencies: string[];
};

export type CinematicShotPurpose =
  | "intro-shot"
  | "establish-environment"
  | "reveal-subject"
  | "escalation-shot"
  | "emotional-beat"
  | "transition-shot"
  | "gameplay-return";

export type CinematicSceneSequenceShot = {
  shot_id: string;
  shot_order: number;
  shot_purpose: CinematicShotPurpose;
  emotional_intent: string;
  gameplay_trigger: string;
  continuity_dependencies: string[];
  required_assets: string[];
  camera_behavior: string;
  transition_notes: string;
  character_ids: string[];
  environment_id: string;
  lighting_reference: string;
  prop_ids: string[];
  tone_reference: string;
  timeline_position: number;
};

export type CinematicSceneSequence = {
  sequence_id: string;
  title: string;
  beat_id: string;
  shots: CinematicSceneSequenceShot[];
};

export type GameplayCutsceneTriggerType =
  | "boss-intro"
  | "mission-completion"
  | "lore-discovery"
  | "emotional-reveal"
  | "memory-flashback"
  | "gameplay-escalation"
  | "player-defeat-victory";

export type GameplayCutsceneTriggerPlan = {
  trigger_id: string;
  trigger_type: GameplayCutsceneTriggerType;
  title: string;
  gameplay_state: string;
  cinematic_state: string;
  activation_conditions: string[];
  target_sequence_id: string;
  transition_notes: string[];
};

export type CinematicShotRecord = {
  shot_id: string;
  recorded_at: string;
  beat_id: string;
  intent: string;
  camera_framing: string;
  camera_motion: string;
  lens_language: string;
  lighting_direction: string;
  outcome: string;
};

export type CinematicAssetRecord = {
  asset_id: string;
  kind: "image" | "video" | "audio" | "prompt" | "edit";
  label: string;
  source: string;
  reusable: boolean;
  reuse_notes: string[];
};

export type CinematicGenerationOutcome = {
  generation_id: string;
  recorded_at: string;
  shot_id: string;
  status: "failed" | "successful";
  prompt_summary: string;
  engine: string;
  cost_tier: CostTier;
  asset_ids: string[];
  notes: string[];
};

export type CinematicGameplayContext = {
  current_sequence: string;
  trigger_conditions: string[];
  player_state_requirements: string[];
  blocked_by: string[];
  downstream_payoffs: string[];
};

export type CinematicGenerationProvider = "Sora" | "Seedance" | "Runway" | "Veo" | "LocalFutureProvider";

export type CinematicGenerationStatus =
  | "planned"
  | "queued"
  | "generating"
  | "validating"
  | "approved"
  | "failed"
  | "retry-required"
  | "archived";

export type CinematicGenerationValidationState =
  | "pending"
  | "validated"
  | "continuity-blocked"
  | "missing-dependencies"
  | "invalid-shot-ordering"
  | "stale-asset-references"
  | "retry-loop-blocked";

export type CinematicGenerationPromptPayload = {
  compiled_prompt: string;
  provider_payload_version: string;
  camera_intent: string;
  asset_reuse_candidates: string[];
  execution_notes: string[];
  normalized_prompt?: string;
  duration_target_seconds?: number;
  resolution?: CinematicVideoResolution;
  frame_rate?: number;
};

export type CinematicGenerationContinuityContext = {
  dependency_shot_ids: string[];
  continuity_constraints: string[];
  preserved_output_refs: string[];
  sequence_order_index: number;
};

export type CinematicGenerationJob = {
  job_id: string;
  project_key: string;
  provider: CinematicGenerationProvider;
  sequence_id: string;
  shot_id: string;
  prompt_payload: CinematicGenerationPromptPayload;
  continuity_context: CinematicGenerationContinuityContext;
  generation_status: CinematicGenerationStatus;
  retry_count: number;
  estimated_cost: number;
  output_refs: string[];
  validation_state: CinematicGenerationValidationState;
  requires_manual_approval: boolean;
  manual_approval_status: CinematicOperatorApprovalStatus;
  approval_token_id: string | null;
  deferred_until: string | null;
  last_operator_action_at: string | null;
  created_at: string;
};

export type CinematicProviderRoutingMode =
  | "cheap-draft-provider"
  | "premium-cinematic-provider"
  | "offline-planning-mode"
  | "future-local-inference-mode"
  | "balanced-comparison-mode";

export type CinematicProviderRoutingDecision = {
  provider: CinematicGenerationProvider;
  routing_mode: CinematicProviderRoutingMode;
  rationale: string;
  estimated_cost_tier: CostTier;
};

export type CinematicProviderAdapterStub = {
  provider: CinematicGenerationProvider;
  summary: string;
  supported_modes: CinematicProviderRoutingMode[];
  stub_capabilities: string[];
};

export type CinematicVideoResolution = "720p" | "1080p" | "1440p" | "4k";

export type CinematicProviderEstimatedCostProfile = {
  draft: number;
  standard: number;
  premium: number;
};

export type CinematicProviderCapability = {
  provider: CinematicGenerationProvider;
  max_duration_seconds: number;
  max_prompt_characters: number;
  supported_resolutions: CinematicVideoResolution[];
  supported_frame_rates: number[];
  continuity_support: "full" | "partial" | "limited";
  image_reference_support: boolean;
  max_image_references: number;
  estimated_cost_profile: CinematicProviderEstimatedCostProfile;
  queue_behavior: string;
  retry_recommendation: string;
};

export type CinematicPromptNormalizationResult = {
  provider: CinematicGenerationProvider;
  normalized_prompt: string;
  trimmed: boolean;
  token_budget_hint: number;
};

export type CinematicProviderPayload = {
  job_id: string;
  provider: CinematicGenerationProvider;
  normalized_prompt: string;
  continuity_context: string[];
  shot_references: string[];
  asset_references: string[];
  camera_instructions: string[];
  duration_seconds: number;
  resolution: CinematicVideoResolution;
  frame_rate: number;
  style_guidance: string[];
  retry_metadata: string[];
  provider_payload: Record<string, unknown>;
};

export type CinematicProviderPayloadValidationIssueCategory =
  | "overlong-prompt"
  | "unsupported-duration"
  | "invalid-reference-count"
  | "continuity-incompatibility"
  | "unsupported-resolution"
  | "unsupported-frame-rate"
  | "provider-specific-restriction";

export type CinematicProviderPayloadValidationIssue = {
  category: CinematicProviderPayloadValidationIssueCategory;
  detail: string;
};

export type CinematicProviderPayloadValidationResult = {
  provider: CinematicGenerationProvider;
  valid: boolean;
  issues: CinematicProviderPayloadValidationIssue[];
};

export type CinematicGenerationBudgetPolicy = {
  max_shots_per_batch: number;
  max_retries_per_job: number;
  max_estimated_sequence_cost: number;
  provider_cooldown_minutes: number;
  sandbox_only_mode: boolean;
  manual_approval_required: boolean;
};

export type CinematicGenerationBudgetEnforcementResult = {
  allowed: boolean;
  total_estimated_sequence_cost: number;
  estimated_retry_cost: number;
  issues: string[];
  applied_policy: CinematicGenerationBudgetPolicy;
};

export type CinematicManualApprovalGateResult = {
  manual_approval_required: boolean;
  manual_approval_granted: boolean;
  queue_preparation_allowed: boolean;
  provider_execution_allowed: boolean;
  blocked_reason: string | null;
  persisted: boolean;
};

export type CinematicOperatorApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "retry-requested"
  | "archived"
  | "deferred";

export type CinematicOperatorAction =
  | "approve-job"
  | "reject-job"
  | "request-retry-plan"
  | "archive-failed-plan"
  | "sandbox-simulate-only"
  | "defer-execution"
  | "budget-override"
  | "continuity-review-note"
  | "preview-real-provider-dry-run"
  | "export-submission-package";

export type CinematicExecutionApprovalToken = {
  token_id: string;
  operator_id: string;
  provider: CinematicGenerationProvider;
  sequence_id: string;
  job_ids: string[];
  issued_at: string;
  expires_at: string;
  token_scope: "future-real-execution-bridge";
  active: boolean;
};

export type CinematicBudgetGovernanceDecision = {
  decision_id: string;
  operator_id: string;
  provider: CinematicGenerationProvider;
  sequence_id: string;
  requested_budget_cap: number;
  approved_override: boolean;
  reason: string;
  recorded_at: string;
};

export type CinematicApprovalAuditEntry = {
  audit_id: string;
  append_only_index: number;
  action: CinematicOperatorAction;
  operator_id: string;
  provider: CinematicGenerationProvider;
  sequence_id: string;
  job_ids: string[];
  detail: string;
  recorded_at: string;
  sandbox_only: boolean;
  approval_token_id: string | null;
  budget_override_decision_id: string | null;
};

export type CinematicDeferredExecutionPlan = {
  defer_id: string;
  operator_id: string;
  provider: CinematicGenerationProvider;
  sequence_id: string;
  job_ids: string[];
  reason: string;
  deferred_until: string;
  recorded_at: string;
  status: "deferred" | "released" | "cancelled";
};

export type CinematicContinuityReviewNote = {
  note_id: string;
  operator_id: string;
  sequence_id: string;
  shot_id: string | null;
  detail: string;
  dependency_snapshot: string[];
  recorded_at: string;
};

export type CinematicExecutionReadinessCheckName =
  | "approval-present"
  | "budget-available"
  | "continuity-validated"
  | "dependencies-resolved"
  | "provider-compatibility"
  | "retry-limits"
  | "cooldown-state";

export type CinematicExecutionReadinessCheck = {
  check: CinematicExecutionReadinessCheckName;
  passed: boolean;
  detail: string;
};

export type CinematicExecutionReadinessReport = {
  provider: CinematicGenerationProvider;
  sequence_id: string;
  job_ids: string[];
  ready_for_real_execution: boolean;
  approval_token_valid: boolean;
  approval_token: CinematicExecutionApprovalToken | null;
  checks: CinematicExecutionReadinessCheck[];
  blocked_reasons: string[];
};

export type CinematicApprovalActionResult = {
  jobs: CinematicGenerationJob[];
  token: CinematicExecutionApprovalToken | null;
  audit_entries: CinematicApprovalAuditEntry[];
  persisted: boolean;
};

export type CinematicProviderCostForecast = {
  provider: CinematicGenerationProvider;
  draft_cost: number;
  standard_cost: number;
  premium_cost: number;
};

export type CinematicCostForecast = {
  sequence_id: string;
  provider: CinematicGenerationProvider;
  estimated_sequence_cost: number;
  estimated_retry_cost: number;
  provider_variance: number;
  draft_vs_premium_tradeoff: string;
  provider_forecasts: CinematicProviderCostForecast[];
};

export type CinematicExecutionValidationIssueCategory =
  | "continuity-compatibility"
  | "missing-dependencies"
  | "invalid-shot-ordering"
  | "stale-asset-references"
  | "retry-loop"
  | "provider-validation"
  | "budget-enforcement"
  | "manual-approval-gate";

export type CinematicExecutionValidationIssue = {
  category: CinematicExecutionValidationIssueCategory;
  shot_id?: string;
  detail: string;
};

export type CinematicExecutionValidationResult = {
  sequence_id: string;
  valid: boolean;
  issues: CinematicExecutionValidationIssue[];
};

export type CinematicShotBatchPlan = {
  batch_id: string;
  provider: CinematicGenerationProvider;
  sequence_id: string;
  shot_ids: string[];
  job_ids: string[];
  reusable_environment_ids: string[];
  reusable_character_ids: string[];
  continuity_dependency_shot_ids: string[];
  regeneration_only: boolean;
};

export type CinematicGenerationJobHistoryEntry = {
  event_id: string;
  job_id: string;
  provider: CinematicGenerationProvider;
  shot_id: string;
  generation_status: CinematicGenerationStatus;
  validation_state: CinematicGenerationValidationState;
  detail: string;
  recorded_at: string;
};

export type CinematicSandboxSimulationRecord = {
  simulation_id: string;
  sandbox_kind: "provider-execution-sandbox" | "local-inference-execution-sandbox" | "local-model-loader-runtime-activation-simulation" | "controlled-local-inference-bootstrap" | "gated-inference-activation-precursor" | "dry-inference-warmup-single-frame-precursor" | "gated-single-frame-dry-execution-path" | "governed-single-frame-synthesis-preparation" | "governed-low-resolution-frame-synthesis-sandbox";
  sequence_id: string;
  routing_mode: CinematicProviderRoutingMode;
  provider: CinematicGenerationProvider;
  execution_enabled: false;
  queued_job_ids: string[];
  approved_job_ids: string[];
  failed_job_ids: string[];
  retry_job_ids: string[];
  continuity_issue_count: number;
  asset_reuse_decisions: string[];
  renderer_lifecycle_states?: CinematicLocalRendererLifecycleState[];
  gpu_allocation?: CinematicGpuAllocationModel;
  queue_plan?: CinematicLocalQueueSimulationPlan;
  recovery_plan?: CinematicRendererRecoveryPlan;
  loader_registry?: CinematicLocalModelLoaderRecord[];
  activation_lifecycle_states?: CinematicRuntimeActivationSimulationState[];
  compatibility_validation?: CinematicModelRuntimeCompatibilityValidation;
  activation_recovery_plan?: CinematicActivationFailureRecoveryPlan;
  future_activation_plan?: CinematicFutureActivationPlan;
  dry_runtime_bootstrap?: CinematicDryRuntimeBootstrapValidation;
  execution_boundary_status?: CinematicExecutionBoundaryState;
  runtime_integrity_validation?: CinematicRuntimeIntegrityValidation;
  activation_readiness_scoring?: CinematicActivationReadinessScoring;
  controlled_runtime_profiles?: CinematicControlledRuntimeProfileEvaluation[];
  future_inference_activation?: CinematicFutureInferenceActivationPlan;
  activation_authority_registry?: CinematicActivationAuthorityRegistryEntry[];
  pre_inference_gate_validation?: CinematicPreInferenceGateValidation;
  inference_entry_sequencing?: CinematicInferenceEntrySequencing;
  forbidden_execution_states?: CinematicForbiddenExecutionStateEnforcement;
  governance_escalation_modeling?: CinematicGovernanceEscalationModeling;
  future_unlock_conditions?: CinematicFutureUnlockConditions;
  execution_temperature_state?: CinematicExecutionTemperatureStateRecord;
  dry_inference_warmup?: CinematicDryInferenceWarmup;
  single_frame_execution_precursor?: CinematicSingleFrameExecutionPrecursor;
  frame_stage_readiness?: CinematicFrameStageReadinessValidation;
  warmup_escalation_modeling?: CinematicWarmupEscalationModeling;
  future_bounded_execution_rules?: CinematicFutureBoundedExecutionRules;
  dry_execution_token_registry?: CinematicDryExecutionTokenRegistryEntry[];
  single_frame_dry_execution_path?: CinematicSingleFrameDryExecutionPath;
  frame_traversal_validation?: CinematicFrameTraversalValidation;
  dry_execution_recovery?: CinematicDryExecutionRecoveryModeling;
  future_frame_synthesis_unlocks?: CinematicFutureFrameSynthesisUnlocks;
  execution_attempt_ledger?: CinematicExecutionAttemptLedger;
  synthesis_containment_registry?: CinematicSynthesisContainmentRegistryEntry[];
  governed_synthesis_preparation?: CinematicGovernedSynthesisPreparationPath;
  synthesis_validation_layer?: CinematicSynthesisValidationLayer;
  contained_escalation_modeling?: CinematicContainedEscalationModeling;
  future_low_resolution_output?: CinematicFutureLowResolutionOutputScaffolding;
  governed_rollback_ledger?: CinematicGovernedRollbackLedger;
  real_output_authorization_registry?: CinematicRealOutputAuthorizationRegistryEntry[];
  governed_low_resolution_sandbox?: CinematicGovernedLowResolutionSandbox;
  first_real_synthesis_path?: CinematicFirstRealSynthesisPath;
  output_containment_validation?: CinematicOutputContainmentValidation;
  real_output_rollback?: CinematicRealOutputRollbackLayer;
  future_renderer_escalation?: CinematicFutureRendererEscalationScaffolding;
  readiness_tracking_id?: string | null;
  hybrid_escalation?: CinematicHybridEscalationSimulation | null;
  recorded_at: string;
};

export type PlannedCinematicExecutionResult = {
  routing: CinematicProviderRoutingDecision;
  validation: CinematicExecutionValidationResult;
  jobs: CinematicGenerationJob[];
  batches: CinematicShotBatchPlan[];
  blocked: boolean;
  persisted: boolean;
};

export type CinematicProviderOutputComparison = {
  provider: CinematicGenerationProvider;
  approved_jobs: number;
  failed_jobs: number;
  total_outputs: number;
  total_estimated_cost: number;
};

export type CinematicApprovalEscalationReasonCode =
  | "cost-threshold"
  | "retry-threshold"
  | "continuity-risk"
  | "premium-provider"
  | "large-batch";

export type CinematicApprovalEscalationReason = {
  code: CinematicApprovalEscalationReasonCode;
  severity: "warning" | "critical";
  detail: string;
};

export type CinematicApprovalEscalationReport = {
  provider: CinematicGenerationProvider;
  sequence_id: string;
  job_ids: string[];
  requires_additional_approval: boolean;
  cost_threshold: number;
  retry_threshold: number;
  large_batch_threshold: number;
  reasons: CinematicApprovalEscalationReason[];
};

export type CinematicRealProviderPayloadExport = {
  job_id: string;
  provider: CinematicGenerationProvider;
  sequence_id: string;
  shot_id: string;
  normalized_prompt: string;
  provider_ready_json: string;
  continuity_references: string[];
  shot_references: string[];
  asset_references: string[];
  retry_metadata: string[];
  estimated_cost: number;
  execution_notes: string[];
};

export type CinematicProviderDryRunConstraintResult = {
  job_id: string;
  provider: CinematicGenerationProvider;
  provider_response: "accepted-dry-run" | "rejected-dry-run";
  accepted: boolean;
  estimated_queue_minutes: number;
  estimated_cost_impact: number;
  retry_routing: string;
  continuity_preservation: string;
  issues: CinematicProviderPayloadValidationIssue[];
};

export type CinematicRealProviderDryRunPreview = {
  provider: CinematicGenerationProvider;
  sequence_id: string;
  job_ids: string[];
  payload_exports: CinematicRealProviderPayloadExport[];
  constraint_results: CinematicProviderDryRunConstraintResult[];
  provider_acceptance: boolean;
  estimated_total_queue_minutes: number;
  estimated_total_cost_impact: number;
  retry_routing_summary: string[];
  continuity_preservation_summary: string[];
  additional_approval_required: boolean;
  escalation: CinematicApprovalEscalationReport;
};

export type CinematicRealProviderDryRunResult = {
  preview: CinematicRealProviderDryRunPreview;
  audit_entries: CinematicApprovalAuditEntry[];
  persisted: boolean;
};

export type CinematicSubmissionSequencePackage = {
  sequence_id: string;
  title: string;
  beat_id: string;
  provider: CinematicGenerationProvider;
  shot_ids: string[];
  job_ids: string[];
  total_estimated_cost: number;
};

export type CinematicSubmissionShotPackage = {
  shot_id: string;
  job_id: string;
  prompt_summary: string;
  continuity_dependencies: string[];
  asset_references: string[];
  retry_count: number;
  estimated_cost: number;
};

export type CinematicSubmissionProviderPackage = {
  provider: CinematicGenerationProvider;
  queue_behavior: string;
  retry_recommendation: string;
  payload_exports: CinematicRealProviderPayloadExport[];
};

export type CinematicExecutionManifest = {
  manual_execution_only: true;
  ready_for_manual_submission: boolean;
  estimated_total_queue_minutes: number;
  estimated_total_cost_impact: number;
  blocked_reasons: string[];
  continuity_preservation_summary: string[];
};

export type CinematicOperatorApprovalManifest = {
  manual_approval_required: boolean;
  approval_token_id: string | null;
  approval_token_valid: boolean;
  additional_approval_required: boolean;
  escalation_reasons: string[];
  blocked_reasons: string[];
};

export type CinematicSubmissionPackage = {
  provider: CinematicGenerationProvider;
  sequence_id: string;
  job_ids: string[];
  sequence_package: CinematicSubmissionSequencePackage;
  shot_package: CinematicSubmissionShotPackage[];
  provider_package: CinematicSubmissionProviderPackage;
  execution_manifest: CinematicExecutionManifest;
  operator_approval_manifest: CinematicOperatorApprovalManifest;
  audit_references: string[];
  package_json: string;
};

export type CinematicSubmissionPackageResult = {
  submission_package: CinematicSubmissionPackage;
  audit_entries: CinematicApprovalAuditEntry[];
  persisted: boolean;
};

export type CinematicProviderReadinessComparison = {
  provider: CinematicGenerationProvider;
  estimated_cost: number;
  duration_support: string;
  continuity_support: string;
  retry_tolerance: string;
  quality_profile: string;
  queue_behavior: string;
  expected_risk: "low" | "medium" | "high";
  valid: boolean;
  issues: string[];
};

export type CinematicLocalVideoModelStatus = "candidate" | "download-planned" | "validated";

export type CinematicLocalVideoGenerationMode = "text-to-video" | "image-to-video" | "video-to-video";

export type CinematicLocalVideoModelProfile = {
  model_id: string;
  display_name: string;
  backend_family: "wan" | "ltx-video" | "hunyuan-video" | "cogvideo" | "generic-open-source";
  generation_mode: CinematicLocalVideoGenerationMode;
  status: CinematicLocalVideoModelStatus;
  supported_resolutions: CinematicVideoResolution[];
  max_duration_seconds: number;
  continuity_support: "limited" | "partial" | "full";
  vram_requirement_gb: number;
  storage_requirement_gb: number;
  quantization_profiles: string[];
  notes: string[];
};

export type CinematicLocalRuntimeStatus = "candidate" | "configured" | "detected";

export type CinematicLocalModelLoaderStatus = "registered" | "dependency-review" | "activation-ready" | "blocked";

export type CinematicLocalModelLoaderRecord = {
  loader_id: string;
  model_name: string;
  model_type: CinematicLocalVideoGenerationMode;
  model_path: string;
  runtime_target: string;
  estimated_vram: number;
  estimated_load_time: number;
  dependency_requirements: string[];
  supported_resolution: CinematicVideoResolution[];
  supported_duration: number;
  continuity_support: CinematicLocalVideoModelProfile["continuity_support"];
  offline_viability: boolean;
  status: CinematicLocalModelLoaderStatus;
};

export type CinematicRuntimeActivationStateName =
  | "loader_registered"
  | "dependency_checking"
  | "runtime_preparing"
  | "model_loading_simulated"
  | "vram_reserving"
  | "inference_ready_simulated"
  | "activation_blocked"
  | "activation_recovering"
  | "activation_archived";

export type CinematicRuntimeActivationSimulationState = {
  state: CinematicRuntimeActivationStateName;
  order: number;
  simulated: true;
  detail: string;
  blockers: string[];
};

export type CinematicModelRuntimeCompatibilityIssueCode =
  | "model-runtime-mismatch"
  | "insufficient-vram"
  | "missing-dependencies"
  | "unsupported-duration"
  | "unsupported-resolution"
  | "missing-model-path"
  | "unsupported-continuity-mode";

export type CinematicModelRuntimeCompatibilityIssue = {
  code: CinematicModelRuntimeCompatibilityIssueCode;
  loader_id: string;
  detail: string;
};

export type CinematicModelRuntimeCompatibilityValidation = {
  valid: boolean;
  preferred_loader_id: string | null;
  issues: CinematicModelRuntimeCompatibilityIssue[];
  blockers: string[];
  fallback_runtime_id: string | null;
};

export type CinematicActivationFailureCause =
  | "missing-runtime"
  | "missing-model-files"
  | "insufficient-vram"
  | "dependency-mismatch"
  | "storage-pressure"
  | "unsupported-provider-route"
  | "corrupted-cache";

export type CinematicActivationRecoveryStep = {
  cause: CinematicActivationFailureCause;
  sequence_order: number;
  detail: string;
};

export type CinematicActivationFailureRecoveryPlan = {
  blocked: boolean;
  causes: CinematicActivationFailureCause[];
  fallback_runtime_id: string | null;
  next_safe_steps: CinematicActivationRecoveryStep[];
};

export type CinematicExecutionBoundaryStatus =
  | "simulated"
  | "dry_initialized"
  | "partially_activated"
  | "inference_disabled"
  | "rendering_disabled"
  | "execution_blocked";

export type CinematicExecutionBoundaryState = {
  boundary_id: string;
  source: "controlled-local-inference-bootstrap" | "runtime-activation-simulation";
  recorded_at: string;
  current_status: CinematicExecutionBoundaryStatus;
  tracked_statuses: CinematicExecutionBoundaryStatus[];
  activation_blockers: string[];
  disabled_execution_reasons: string[];
  next_activation_milestone: string;
  missing_dependencies: string[];
  governance_restrictions: string[];
};

export type CinematicDryRuntimeBootstrapCheckName =
  | "runtime-path-validity"
  | "runtime-binary-presence"
  | "python-environment-visibility"
  | "ffmpeg-visibility"
  | "model-directory-visibility"
  | "dependency-file-visibility"
  | "storage-readiness"
  | "writable-cache-locations";

export type CinematicDryRuntimeBootstrapCheck = {
  check: CinematicDryRuntimeBootstrapCheckName;
  passed: boolean;
  detail: string;
  candidate_paths: string[];
  detected_paths: string[];
};

export type CinematicDryRuntimeBootstrapValidation = {
  valid: boolean;
  checks: CinematicDryRuntimeBootstrapCheck[];
  activation_blockers: string[];
  missing_dependencies: string[];
};

export type CinematicRuntimeIntegrityIssueCode =
  | "missing-runtime-binaries"
  | "invalid-model-paths"
  | "unsupported-runtime-versions"
  | "incompatible-dependency-sets"
  | "invalid-cache-locations"
  | "unsupported-hardware-profiles";

export type CinematicRuntimeIntegrityIssue = {
  code: CinematicRuntimeIntegrityIssueCode;
  detail: string;
};

export type CinematicRuntimeIntegrityValidation = {
  valid: boolean;
  issues: CinematicRuntimeIntegrityIssue[];
  blockers: string[];
  missing_dependencies: string[];
};

export type CinematicActivationReadinessDimension =
  | "runtime-readiness"
  | "loader-readiness"
  | "inference-readiness"
  | "renderer-readiness"
  | "continuity-readiness"
  | "offline-readiness";

export type CinematicActivationReadinessRiskLevel = "low" | "medium" | "high" | "critical";

export type CinematicActivationReadinessTrend = "accelerating" | "flat" | "decelerating" | "new";

export type CinematicActivationReadinessScore = {
  dimension: CinematicActivationReadinessDimension;
  score: number;
  confidence: CinematicReadinessConfidence;
  blockers: string[];
  risk_level: CinematicActivationReadinessRiskLevel;
  trend: CinematicActivationReadinessTrend;
};

export type CinematicActivationReadinessScoring = {
  recorded_at: string;
  scores: CinematicActivationReadinessScore[];
};

export type CinematicControlledRuntimeProfileId =
  | "low_vram_safe"
  | "offline_safe"
  | "continuity_priority"
  | "cloud_hybrid_safe"
  | "cpu_fallback_safe";

export type CinematicControlledRuntimeProfile = {
  profile_id: CinematicControlledRuntimeProfileId;
  display_name: string;
  summary: string;
  routing_mode: CinematicProviderRoutingMode;
  governance_notes: string[];
};

export type CinematicControlledRuntimeProfileEvaluation = {
  profile_id: CinematicControlledRuntimeProfileId;
  viable: boolean;
  reasons: string[];
  execution_boundary_status: CinematicExecutionBoundaryStatus;
};

export type CinematicActivationAuthorityScope =
  | "dry_pipeline_binding"
  | "gated_inference_prepare"
  | "gated_runtime_bind"
  | "gated_scheduler_prepare"
  | "gated_frame_stage_prepare"
  | "gated_temporal_stage_prepare"
  | "gated_render_output_prepare";

export type CinematicActivationAuthorityRegistryEntry = {
  authority_id: string;
  activation_scope: CinematicActivationAuthorityScope;
  allowed_transition: string;
  forbidden_transition: string;
  required_approval: string[];
  governance_dependencies: string[];
  continuity_dependencies: string[];
  runtime_dependencies: string[];
  execution_boundary_requirements: string[];
};

export type CinematicPreInferenceGateName =
  | "execution-boundary-intact"
  | "dry-bootstrap-complete"
  | "dry-model-initialization-complete"
  | "dry-scheduler-planning-complete"
  | "dry-pipeline-binding-complete"
  | "governance-approval-present"
  | "continuity-state-available"
  | "runtime-integrity-acceptable";

export type CinematicPreInferenceGateCheck = {
  gate: CinematicPreInferenceGateName;
  passed: boolean;
  detail: string;
  blockers: string[];
};

export type CinematicPreInferenceGateValidation = {
  validation_id: string;
  recorded_at: string;
  valid: boolean;
  checks: CinematicPreInferenceGateCheck[];
  blocked_transitions: string[];
  next_unlock_condition: string;
};

export type CinematicInferenceEntrySequenceStage =
  | "gated_inference_prepare"
  | "gated_runtime_bind"
  | "gated_scheduler_prepare"
  | "gated_frame_stage_prepare"
  | "gated_temporal_stage_prepare"
  | "gated_render_output_prepare";

export type CinematicInferenceEntrySequenceState = {
  stage: CinematicInferenceEntrySequenceStage;
  order: number;
  simulated: true;
  status: "ready" | "blocked";
  detail: string;
  blockers: string[];
};

export type CinematicInferenceEntrySequencing = {
  sequencing_id: string;
  recorded_at: string;
  stages: CinematicInferenceEntrySequenceState[];
  next_stage: CinematicInferenceEntrySequenceStage | null;
};

export type CinematicForbiddenExecutionState =
  | "inference_execute"
  | "frame_generate"
  | "renderer_activate"
  | "temporal_render"
  | "unattended_execution"
  | "autonomous_retry_loops"
  | "uncontrolled_runtime_launch";

export type CinematicForbiddenExecutionStateEntry = {
  state: CinematicForbiddenExecutionState;
  blocked: true;
  reason: string;
};

export type CinematicForbiddenExecutionStateEnforcement = {
  enforcement_id: string;
  recorded_at: string;
  states: CinematicForbiddenExecutionStateEntry[];
};

export type CinematicGovernanceEscalationKind =
  | "manual-approval-escalation"
  | "runtime-risk-escalation"
  | "high-vram-escalation"
  | "offline-mode-escalation"
  | "continuity-risk-escalation"
  | "self-sustaining-mode-escalation";

export type CinematicGovernanceEscalationScenario = {
  escalation: CinematicGovernanceEscalationKind;
  triggered: boolean;
  detail: string;
  blockers: string[];
};

export type CinematicGovernanceEscalationModeling = {
  escalation_id: string;
  recorded_at: string;
  scenarios: CinematicGovernanceEscalationScenario[];
};

export type CinematicFutureUnlockConditionId =
  | "dry-inference-warmup"
  | "dry-frame-synthesis-warmup"
  | "gated-single-frame-inference"
  | "gated-low-resolution-output"
  | "gated-temporal-output"
  | "governed-renderer-output";

export type CinematicFutureUnlockCondition = {
  unlock_id: CinematicFutureUnlockConditionId;
  unlocked: false;
  prerequisites: string[];
  execution_states_still_forbidden: CinematicForbiddenExecutionState[];
  unlocks_real_inference_at: string;
};

export type CinematicFutureUnlockConditions = {
  condition_set_id: string;
  recorded_at: string;
  conditions: CinematicFutureUnlockCondition[];
  milestone_unlocks_real_inference: string;
};

export type CinematicFutureInferenceActivationPlan = {
  dry_model_initialization: boolean;
  dry_vram_reservation: boolean;
  dry_scheduler_initialization: boolean;
  dry_pipeline_binding: boolean;
  dry_render_packaging: boolean;
  notes: string[];
};

export type CinematicExecutionTemperatureState = "cold" | "warming" | "staged" | "gated" | "blocked" | "simulated_only";

export type CinematicExecutionTemperatureTransition = {
  state: CinematicExecutionTemperatureState;
  authority_trigger: string;
  transition_reason: string;
  blockers: string[];
  next_unlock_condition: string;
  governance_state: string;
  continuity_state: string;
};

export type CinematicExecutionTemperatureStateRecord = {
  temperature_id: string;
  recorded_at: string;
  current_state: CinematicExecutionTemperatureState;
  transitions: CinematicExecutionTemperatureTransition[];
};

export type CinematicDryInferenceWarmupStageName =
  | "scheduler_warmup"
  | "pipeline_warmup"
  | "frame_stage_preparation"
  | "continuity_state_preparation"
  | "vram_staging_assumptions"
  | "dry_execution_sequencing";

export type CinematicDryInferenceWarmupStage = {
  stage: CinematicDryInferenceWarmupStageName;
  simulated: true;
  ready: boolean;
  detail: string;
  blockers: string[];
};

export type CinematicDryInferenceWarmup = {
  warmup_id: string;
  recorded_at: string;
  stages: CinematicDryInferenceWarmupStage[];
  next_unlock_condition: string;
  vram_assumptions: string[];
};

export type CinematicSingleFrameExecutionPrecursorId =
  | "gated_single_frame_prepare"
  | "gated_low_resolution_prepare"
  | "gated_preview_prepare"
  | "gated_temporal_prepare"
  | "governed_output_prepare";

export type CinematicSingleFrameExecutionPrecursorEntry = {
  precursor_id: CinematicSingleFrameExecutionPrecursorId;
  scaffolded: true;
  unlocked: false;
  detail: string;
  blockers: string[];
};

export type CinematicSingleFrameExecutionPrecursor = {
  precursor_set_id: string;
  recorded_at: string;
  entries: CinematicSingleFrameExecutionPrecursorEntry[];
};

export type CinematicFrameStageReadinessCheckName =
  | "scheduler-readiness"
  | "pipeline-binding-readiness"
  | "continuity-readiness"
  | "execution-boundary-integrity"
  | "authority-approval-state"
  | "forbidden-state-enforcement"
  | "runtime-integrity-sufficiency";

export type CinematicFrameStageReadinessCheck = {
  check: CinematicFrameStageReadinessCheckName;
  passed: boolean;
  detail: string;
  blockers: string[];
};

export type CinematicFrameStageReadinessValidation = {
  validation_id: string;
  recorded_at: string;
  valid: boolean;
  checks: CinematicFrameStageReadinessCheck[];
  next_unlock_condition: string;
};

export type CinematicWarmupEscalationKind =
  | "warmup-risk-escalation"
  | "low-vram-escalation"
  | "continuity-risk-escalation"
  | "offline-escalation"
  | "hybrid-escalation"
  | "blocked-warmup-recovery";

export type CinematicWarmupEscalationScenario = {
  escalation: CinematicWarmupEscalationKind;
  triggered: boolean;
  detail: string;
  blockers: string[];
};

export type CinematicWarmupEscalationModeling = {
  escalation_id: string;
  recorded_at: string;
  scenarios: CinematicWarmupEscalationScenario[];
};

export type CinematicFutureBoundedExecutionRuleId =
  | "single-frame-only-execution"
  | "low-resolution-only-execution"
  | "governed-preview-generation"
  | "bounded-retry-limits"
  | "manual-only-escalation"
  | "continuity-safe-execution";

export type CinematicFutureBoundedExecutionRule = {
  rule_id: CinematicFutureBoundedExecutionRuleId;
  unlocked: false;
  detail: string;
  governance_requirements: string[];
  blockers: string[];
};

export type CinematicFutureBoundedExecutionRules = {
  rule_set_id: string;
  recorded_at: string;
  rules: CinematicFutureBoundedExecutionRule[];
};

export type CinematicDryExecutionActivationScope =
  | "dry_single_frame_traversal"
  | "dry_low_resolution_traversal"
  | "dry_preview_traversal"
  | "dry_packaging_traversal"
  | "dry_archival_traversal";

export type CinematicDryExecutionTraversalStage =
  | "dry_execution_request"
  | "dry_scheduler_stage"
  | "dry_pipeline_stage"
  | "dry_frame_stage"
  | "dry_packaging_stage"
  | "dry_output_blocked"
  | "dry_execution_archived";

export type CinematicDryExecutionTokenRegistryEntry = {
  token_id: string;
  activation_authority: string;
  execution_scope: CinematicDryExecutionActivationScope;
  allowed_stage: CinematicDryExecutionTraversalStage;
  forbidden_stage: CinematicDryExecutionTraversalStage;
  expiration_policy: string;
  governance_requirements: string[];
  continuity_requirements: string[];
  escalation_policy: string[];
  execution_boundary_requirements: string[];
  execution_restrictions: string[];
  forbidden_operations: string[];
  continuity_restrictions: string[];
  escalation_restrictions: string[];
};

export type CinematicSingleFrameDryExecutionStageState = {
  stage: CinematicDryExecutionTraversalStage;
  order: number;
  simulated: true;
  status: "ready" | "blocked" | "archived";
  detail: string;
  blockers: string[];
};

export type CinematicSingleFrameDryExecutionPath = {
  path_id: string;
  recorded_at: string;
  stages: CinematicSingleFrameDryExecutionStageState[];
  next_stage: CinematicDryExecutionTraversalStage | null;
};

export type CinematicFrameTraversalValidationCheckName =
  | "execution-token-validity"
  | "authority-compatibility"
  | "execution-boundary-integrity"
  | "forbidden-state-enforcement"
  | "continuity-state-readiness"
  | "runtime-integrity-sufficiency"
  | "escalation-compliance";

export type CinematicFrameTraversalValidationCheck = {
  check: CinematicFrameTraversalValidationCheckName;
  passed: boolean;
  detail: string;
  blockers: string[];
};

export type CinematicFrameTraversalValidation = {
  validation_id: string;
  recorded_at: string;
  valid: boolean;
  checks: CinematicFrameTraversalValidationCheck[];
  blocked_transitions: string[];
  next_unlock_condition: string;
};

export type CinematicDryExecutionRecoveryKind =
  | "token-expiration-recovery"
  | "blocked-stage-recovery"
  | "continuity-recovery"
  | "low-vram-recovery"
  | "governance-escalation-recovery"
  | "dry-rollback-sequencing";

export type CinematicDryExecutionRecoveryScenario = {
  recovery: CinematicDryExecutionRecoveryKind;
  triggered: boolean;
  detail: string;
  blockers: string[];
};

export type CinematicDryExecutionRecoveryModeling = {
  recovery_id: string;
  recorded_at: string;
  scenarios: CinematicDryExecutionRecoveryScenario[];
};

export type CinematicFutureFrameSynthesisUnlockId =
  | "governed-single-frame-synthesis"
  | "low-resolution-synthesis"
  | "governed-preview-generation"
  | "bounded-renderer-output"
  | "continuity-safe-synthesis"
  | "temporal-preview-sequencing";

export type CinematicFutureFrameSynthesisUnlock = {
  unlock_id: CinematicFutureFrameSynthesisUnlockId;
  unlocked: false;
  prerequisites: string[];
  still_forbidden_operations: string[];
  unlocks_real_synthesis_at: string;
};

export type CinematicFutureFrameSynthesisUnlocks = {
  unlock_set_id: string;
  recorded_at: string;
  unlocks: CinematicFutureFrameSynthesisUnlock[];
  milestone_unlocks_real_synthesis: string;
};

export type CinematicExecutionAttemptLedgerEntry = {
  attempt_id: string;
  recorded_at: string;
  token_id: string;
  dry_execution_attempt: string;
  blocked_transitions: string[];
  escalation_triggers: string[];
  rollback_reasons: string[];
  authority_approvals: string[];
  execution_temperature_changes: string[];
};

export type CinematicExecutionAttemptLedger = {
  ledger_id: string;
  recorded_at: string;
  attempts: CinematicExecutionAttemptLedgerEntry[];
};

export type CinematicSynthesisContainmentScope =
  | "governed_single_frame_preparation"
  | "governed_thumbnail_preparation"
  | "preview_frame_preparation"
  | "renderer_preview_preparation";

export type CinematicSynthesisContainmentRegistryEntry = {
  containment_id: string;
  synthesis_scope: CinematicSynthesisContainmentScope;
  allowed_resolution: CinematicVideoResolution;
  maximum_resolution: CinematicVideoResolution;
  allowed_frame_count: number;
  maximum_frame_count: number;
  output_permissions: string[];
  output_restrictions: string[];
  rollback_authority: string;
  escalation_authority: string;
  forbidden_synthesis_states: string[];
  continuity_constraints: string[];
  governance_constraints: string[];
  containment_expiration: string;
};

export type CinematicGovernedSynthesisPreparationStage =
  | "synthesis_prepare_request"
  | "synthesis_scheduler_prepare"
  | "synthesis_pipeline_prepare"
  | "synthesis_frame_prepare"
  | "synthesis_output_blocked"
  | "synthesis_prepare_archived";

export type CinematicGovernedSynthesisPreparationStageState = {
  stage: CinematicGovernedSynthesisPreparationStage;
  order: number;
  simulated: true;
  status: "ready" | "blocked" | "archived";
  detail: string;
  blockers: string[];
};

export type CinematicGovernedSynthesisPreparationPath = {
  preparation_id: string;
  recorded_at: string;
  containment_id: string | null;
  stages: CinematicGovernedSynthesisPreparationStageState[];
  next_stage: CinematicGovernedSynthesisPreparationStage | null;
};

export type CinematicSynthesisValidationCheckName =
  | "synthesis-containment-validity"
  | "execution-token-compatibility"
  | "continuity-state-readiness"
  | "governance-approval-state"
  | "forbidden-state-enforcement"
  | "runtime-integrity-sufficiency"
  | "escalation-compliance"
  | "output-block-enforcement";

export type CinematicSynthesisValidationCheck = {
  check: CinematicSynthesisValidationCheckName;
  passed: boolean;
  detail: string;
  blockers: string[];
};

export type CinematicSynthesisValidationLayer = {
  validation_id: string;
  recorded_at: string;
  valid: boolean;
  checks: CinematicSynthesisValidationCheck[];
  blocked_transitions: string[];
  next_unlock_condition: string;
};

export type CinematicContainedEscalationKind =
  | "low-resolution-escalation"
  | "continuity-risk-escalation"
  | "blocked-output-escalation"
  | "rollback-escalation"
  | "containment-expiration-recovery"
  | "bounded-retry-escalation";

export type CinematicContainedEscalationScenario = {
  escalation: CinematicContainedEscalationKind;
  triggered: boolean;
  detail: string;
  blockers: string[];
};

export type CinematicContainedEscalationModeling = {
  escalation_id: string;
  recorded_at: string;
  scenarios: CinematicContainedEscalationScenario[];
};

export type CinematicFutureLowResolutionOutputId =
  | "governed-thumbnail-synthesis"
  | "governed-preview-frame-synthesis"
  | "bounded-low-resolution-output"
  | "continuity-safe-preview-rendering"
  | "governed-renderer-preview-mode";

export type CinematicFutureLowResolutionOutputEntry = {
  output_id: CinematicFutureLowResolutionOutputId;
  unlocked: false;
  prerequisites: string[];
  still_forbidden_operations: string[];
  target_resolution: CinematicVideoResolution;
};

export type CinematicFutureLowResolutionOutputScaffolding = {
  scaffold_id: string;
  recorded_at: string;
  outputs: CinematicFutureLowResolutionOutputEntry[];
  milestone_unlocks_governed_output: string;
};

export type CinematicGovernedRollbackLedgerEntry = {
  entry_id: string;
  recorded_at: string;
  containment_id: string;
  synthesis_preparation_attempt: string;
  rollback_events: string[];
  blocked_output_attempts: string[];
  containment_violations: string[];
  escalation_triggers: string[];
  rollback_authority_actions: string[];
  execution_temperature_transitions: string[];
};

export type CinematicGovernedRollbackLedger = {
  ledger_id: string;
  recorded_at: string;
  entries: CinematicGovernedRollbackLedgerEntry[];
};

export type CinematicRealOutputAuthorizationScope =
  | "governed_low_resolution_single_frame"
  | "governed_preview_frame_output"
  | "bounded_preview_target";

export type CinematicRealOutputAuthorizationRegistryEntry = {
  authorization_id: string;
  synthesis_scope: CinematicRealOutputAuthorizationScope;
  authorized_output_scope: CinematicRealOutputAuthorizationScope;
  allowed_resolution: CinematicVideoResolution;
  maximum_resolution: CinematicVideoResolution;
  allowed_frame_count: number;
  maximum_frame_count: number;
  allowed_output_targets: string[];
  output_retention_policy: string;
  rollback_authority: string;
  shutdown_authority: string;
  emergency_shutdown_authority: string;
  continuity_constraints: string[];
  governance_constraints: string[];
  authorization_expiration: string;
  forbidden_output_behaviors: string[];
};

export type CinematicGovernedLowResolutionSandbox = {
  sandbox_id: string;
  recorded_at: string;
  authorization_id: string | null;
  output_root: string;
  output_target: string;
  output_file_path: string | null;
  output_retention_policy: string;
  maximum_resolution: CinematicVideoResolution;
  maximum_frame_count: number;
  bounded_retry_limit: number;
  manual_approval_required: true;
  rollback_enabled: true;
  real_output_written: boolean;
  real_output_mime_type: string | null;
  deleted_output_targets: string[];
};

export type CinematicFirstRealSynthesisStage =
  | "governed_output_request"
  | "scheduler_bind"
  | "pipeline_bind"
  | "single_frame_synthesis"
  | "bounded_output_write"
  | "rollback_ready"
  | "synthesis_archived";

export type CinematicFirstRealSynthesisStageState = {
  stage: CinematicFirstRealSynthesisStage;
  order: number;
  status: "ready" | "completed" | "rollback_ready" | "archived" | "blocked";
  detail: string;
  blockers: string[];
};

export type CinematicFirstRealSynthesisPath = {
  path_id: string;
  recorded_at: string;
  authorization_id: string | null;
  output_file_path: string | null;
  stages: CinematicFirstRealSynthesisStageState[];
  next_stage: CinematicFirstRealSynthesisStage | null;
};

export type CinematicOutputContainmentValidationCheckName =
  | "authorization-validity"
  | "resolution-restrictions"
  | "frame-count-restrictions"
  | "continuity-state-integrity"
  | "rollback-availability"
  | "runtime-integrity-sufficiency"
  | "forbidden-state-enforcement"
  | "output-target-safety";

export type CinematicOutputContainmentValidationCheck = {
  check: CinematicOutputContainmentValidationCheckName;
  passed: boolean;
  detail: string;
  blockers: string[];
};

export type CinematicOutputContainmentValidation = {
  validation_id: string;
  recorded_at: string;
  valid: boolean;
  checks: CinematicOutputContainmentValidationCheck[];
  blocked_transitions: string[];
  next_unlock_condition: string;
};

export type CinematicRealOutputRollbackActionKind =
  | "rollback-triggered-cleanup"
  | "bounded-output-deletion"
  | "emergency-shutdown-escalation"
  | "rollback-authority-enforcement"
  | "synthesis-attempt-archival"
  | "containment-violation-recovery";

export type CinematicRealOutputRollbackAction = {
  action: CinematicRealOutputRollbackActionKind;
  triggered: boolean;
  detail: string;
  affected_output_targets: string[];
};

export type CinematicRealOutputRollbackLayer = {
  rollback_id: string;
  recorded_at: string;
  actions: CinematicRealOutputRollbackAction[];
};

export type CinematicFutureRendererEscalationId =
  | "governed-multi-frame-synthesis"
  | "governed-temporal-synthesis"
  | "continuity-safe-preview-sequences"
  | "governed-renderer-preview-mode"
  | "governed-teaser-trailer-mode"
  | "governed-cinematic-sequence-mode";

export type CinematicFutureRendererEscalationEntry = {
  escalation_id: CinematicFutureRendererEscalationId;
  unlocked: false;
  prerequisites: string[];
  still_forbidden_operations: string[];
};

export type CinematicFutureRendererEscalationScaffolding = {
  scaffold_id: string;
  recorded_at: string;
  entries: CinematicFutureRendererEscalationEntry[];
  milestone_unlocks_renderer_escalation: string;
};

export type CinematicFutureActivationPlan = {
  future_frame_synthesis_activation: boolean;
  future_temporal_pipeline_activation: boolean;
  future_upscale_activation: boolean;
  future_render_packaging_activation: boolean;
  future_local_only_execution_mode: boolean;
  notes: string[];
};

export type CinematicRuntimeActivationSimulationValidation = {
  readiness: CinematicLocalInferenceReadinessReport;
  readiness_delta: CinematicReadinessDeltaTrackingRecord;
  loader_registry: CinematicLocalModelLoaderRecord[];
  activation_lifecycle_states: CinematicRuntimeActivationSimulationState[];
  compatibility_validation: CinematicModelRuntimeCompatibilityValidation;
  activation_recovery_plan: CinematicActivationFailureRecoveryPlan;
  future_activation_plan: CinematicFutureActivationPlan;
  execution_enabled: false;
};

export type CinematicControlledLocalInferenceBootstrapValidation = {
  readiness: CinematicLocalInferenceReadinessReport;
  readiness_delta: CinematicReadinessDeltaTrackingRecord;
  loader_registry: CinematicLocalModelLoaderRecord[];
  dry_runtime_bootstrap: CinematicDryRuntimeBootstrapValidation;
  execution_boundary_state: CinematicExecutionBoundaryState;
  runtime_integrity_validation: CinematicRuntimeIntegrityValidation;
  activation_readiness_scores: CinematicActivationReadinessScore[];
  controlled_runtime_profiles: CinematicControlledRuntimeProfileEvaluation[];
  future_inference_activation: CinematicFutureInferenceActivationPlan;
  activation_authority_registry: CinematicActivationAuthorityRegistryEntry[];
  pre_inference_gate_validation: CinematicPreInferenceGateValidation;
  inference_entry_sequencing: CinematicInferenceEntrySequencing;
  forbidden_execution_states: CinematicForbiddenExecutionStateEnforcement;
  governance_escalation_modeling: CinematicGovernanceEscalationModeling;
  future_unlock_conditions: CinematicFutureUnlockConditions;
  execution_temperature_state: CinematicExecutionTemperatureStateRecord;
  dry_inference_warmup: CinematicDryInferenceWarmup;
  single_frame_execution_precursor: CinematicSingleFrameExecutionPrecursor;
  frame_stage_readiness: CinematicFrameStageReadinessValidation;
  warmup_escalation_modeling: CinematicWarmupEscalationModeling;
  future_bounded_execution_rules: CinematicFutureBoundedExecutionRules;
  dry_execution_token_registry: CinematicDryExecutionTokenRegistryEntry[];
  single_frame_dry_execution_path: CinematicSingleFrameDryExecutionPath;
  frame_traversal_validation: CinematicFrameTraversalValidation;
  dry_execution_recovery: CinematicDryExecutionRecoveryModeling;
  future_frame_synthesis_unlocks: CinematicFutureFrameSynthesisUnlocks;
  execution_attempt_ledger: CinematicExecutionAttemptLedger;
  synthesis_containment_registry: CinematicSynthesisContainmentRegistryEntry[];
  governed_synthesis_preparation: CinematicGovernedSynthesisPreparationPath;
  synthesis_validation_layer: CinematicSynthesisValidationLayer;
  contained_escalation_modeling: CinematicContainedEscalationModeling;
  future_low_resolution_output: CinematicFutureLowResolutionOutputScaffolding;
  governed_rollback_ledger: CinematicGovernedRollbackLedger;
  real_output_authorization_registry: CinematicRealOutputAuthorizationRegistryEntry[];
  governed_low_resolution_sandbox: CinematicGovernedLowResolutionSandbox;
  first_real_synthesis_path: CinematicFirstRealSynthesisPath;
  output_containment_validation: CinematicOutputContainmentValidation;
  real_output_rollback: CinematicRealOutputRollbackLayer;
  future_renderer_escalation: CinematicFutureRendererEscalationScaffolding;
  execution_enabled: false;
};

export type CinematicControlledLocalInferenceBootstrapResult = {
  validation: CinematicControlledLocalInferenceBootstrapValidation;
  simulation: CinematicSandboxSimulationRecord;
};

export type CinematicLocalModelLoaderRuntimeActivationResult = {
  validation: CinematicRuntimeActivationSimulationValidation;
  simulation: CinematicSandboxSimulationRecord;
};

export type CinematicLocalRuntimeCapability = {
  runtime_id: string;
  display_name: string;
  runtime_family: "comfyui" | "diffusers" | "custom-wrapper";
  status: CinematicLocalRuntimeStatus;
  detection_method: "manual-registration" | "path-config" | "future-runtime-probe";
  supported_backends: Array<"cuda" | "directml" | "rocm" | "cpu">;
  concurrent_job_limit: number;
  supports_asset_cache: boolean;
  supports_operator_review_handoff: boolean;
  notes: string[];
};

export type CinematicLocalHardwareProfileStatus = "planned" | "profiled" | "validated";

export type CinematicLocalHardwareProfile = {
  profile_id: string;
  display_name: string;
  status: CinematicLocalHardwareProfileStatus;
  accelerator_backend: "cuda" | "directml" | "rocm" | "cpu";
  gpu_name: string;
  gpu_vram_gb: number;
  system_ram_gb: number;
  storage_free_gb: number;
  encoder_support: string[];
  recommended_max_resolution: CinematicVideoResolution;
  recommended_max_duration_seconds: number;
  notes: string[];
};

export type CinematicLocalReadinessCheckName =
  | "model-registry-populated"
  | "runtime-detection-configured"
  | "hardware-profile-recorded"
  | "routing-rules-defined"
  | "governance-guardrails-preserved"
  | "cache-strategy-defined";

export type CinematicLocalReadinessCheck = {
  check: CinematicLocalReadinessCheckName;
  passed: boolean;
  detail: string;
};

export type CinematicLocalInferenceReadinessReport = {
  foundation_ready: boolean;
  local_provider_available: boolean;
  ready_for_manual_local_execution: boolean;
  preferred_model_id: string | null;
  preferred_runtime_id: string | null;
  preferred_hardware_profile_id: string | null;
  recommended_routing_mode: CinematicProviderRoutingMode;
  probe_snapshot: CinematicRuntimeProbeSnapshot | null;
  checks: CinematicLocalReadinessCheck[];
  blocked_reasons: string[];
  planning_notes: string[];
  milestone_progress: CinematicReadinessMilestoneProgress[];
};

export type CinematicLocalHardwareEstimate = {
  model_id: string;
  runtime_id: string | null;
  hardware_profile_id: string;
  supported: boolean;
  estimated_generation_minutes: number;
  estimated_cache_gb: number;
  limiting_factors: string[];
};

export type CinematicLocalProviderRoutingPlan = {
  selected_provider: CinematicGenerationProvider;
  routing_mode: CinematicProviderRoutingMode;
  local_provider_ready: boolean;
  fallback_provider: Exclude<CinematicGenerationProvider, "LocalFutureProvider">;
  recommended_model_id: string | null;
  recommended_runtime_id: string | null;
  recommended_hardware_profile_id: string | null;
  reasons: string[];
  cache_strategy: string[];
  governance_requirements: string[];
  hybrid_strategy_ids: CinematicHybridStrategyId[];
};

export type CinematicLocalExecutionPlan = {
  planned_job_ids: string[];
  routing: CinematicLocalProviderRoutingPlan;
  readiness: CinematicLocalInferenceReadinessReport;
  hardware_estimate: CinematicLocalHardwareEstimate | null;
  manual_execution_only: true;
  execution_enabled: false;
  steps: string[];
  blocked_reasons: string[];
  milestone_progress: CinematicReadinessMilestoneProgress[];
};

export type CinematicRuntimeProbeId =
  | "cuda-installation"
  | "gpu-vendor-visibility"
  | "vram-reporting-capability"
  | "ffmpeg-availability"
  | "python-runtime-presence"
  | "inference-runtime-presence"
  | "local-model-directory-presence"
  | "storage-space-estimate";

export type CinematicRuntimeProbeStatus = "detected" | "not-detected" | "derived" | "blocked";

export type CinematicRuntimeProbeAdapter = {
  probe_id: CinematicRuntimeProbeId;
  summary: string;
  read_only: true;
  signals: string[];
};

export type CinematicRuntimeProbePathHints = {
  cuda_paths: string[];
  ffmpeg_paths: string[];
  python_paths: string[];
  inference_runtime_paths: string[];
  local_model_paths: string[];
};

export type CinematicRuntimeProbeResult = {
  probe_id: CinematicRuntimeProbeId;
  status: CinematicRuntimeProbeStatus;
  detail: string;
  candidate_paths: string[];
  detected_paths: string[];
  observed_value: string | null;
  blockers: string[];
};

export type CinematicRuntimeProbeSnapshot = {
  snapshot_id: string;
  recorded_at: string;
  runtime_launch_enabled: false;
  gpu_vendor: string | null;
  storage_free_gb_estimate: number | null;
  results: CinematicRuntimeProbeResult[];
};

export type CinematicFrameGenerationStageName =
  | "prompt-compilation"
  | "latent-preparation"
  | "frame-synthesis"
  | "frame-interpolation"
  | "temporal-continuity"
  | "upscale-stage"
  | "render-packaging"
  | "output-archival";

export type CinematicFrameGenerationStageStatus = "planned" | "foundation" | "modeled";

export type CinematicFrameGenerationStage = {
  stage_id: CinematicFrameGenerationStageName;
  display_name: string;
  status: CinematicFrameGenerationStageStatus;
  description: string;
  dependencies: string[];
  continuity_critical: boolean;
  notes: string[];
};

export type CinematicRendererCapabilityName =
  | "image-sequence-rendering"
  | "frame-interpolation"
  | "temporal-coherence"
  | "continuity-state-reuse"
  | "local-upscaling"
  | "offline-packaging";

export type CinematicRendererCapabilityStatus = "planned" | "foundation" | "modeled";

export type CinematicRendererCapabilityRoadmapEntry = {
  capability_id: CinematicRendererCapabilityName;
  display_name: string;
  status: CinematicRendererCapabilityStatus;
  description: string;
  dependencies: string[];
  notes: string[];
};

export type CinematicRuntimeConstraintModel = {
  model_id: string;
  title: string;
  minimum_vram_tiers_gb: number[];
  low_vram_fallback_viable: boolean;
  storage_scaling: string[];
  render_time_scaling: string[];
  local_queue_pressure: string[];
  hybrid_offload_recommendations: string[];
};

export type CinematicHybridStrategyId =
  | "local-draft-rendering"
  | "cloud-premium-rendering"
  | "offline-safe-mode"
  | "continuity-first-routing"
  | "budget-first-routing"
  | "hardware-aware-escalation";

export type CinematicHybridStrategyStatus = "planned" | "foundation" | "modeled";

export type CinematicHybridLocalCloudStrategy = {
  strategy_id: CinematicHybridStrategyId;
  display_name: string;
  status: CinematicHybridStrategyStatus;
  summary: string;
  preferred_provider_mode: CinematicProviderRoutingMode;
  governance_requirements: string[];
  escalation_conditions: string[];
};

export type CinematicReadinessMilestoneKey =
  | "local-inference-readiness"
  | "local-runtime-readiness"
  | "local-frame-generation-readiness"
  | "local-renderer-readiness"
  | "continuity-preserving-local-generation"
  | "hybrid-local-cloud-orchestration"
  | "self-sustaining-generation-readiness";

export type CinematicReadinessConfidence = "low" | "medium" | "high";

export type CinematicReadinessMilestoneProgress = {
  milestone: CinematicReadinessMilestoneKey;
  percentage: number;
  confidence: CinematicReadinessConfidence;
  blockers: string[];
  next_required_milestone: string;
  estimated_architectural_dependency: string;
  missing_dependencies: string[];
};

export type CinematicReadinessConfidenceTrend = "up" | "flat" | "down" | "new";

export type CinematicReadinessMilestoneDelta = {
  milestone: CinematicReadinessMilestoneKey;
  previous_percentage: number | null;
  current_percentage: number;
  delta: number;
  previous_confidence: CinematicReadinessConfidence | null;
  current_confidence: CinematicReadinessConfidence;
  blockers_cleared: string[];
  blockers_introduced: string[];
  confidence_trend: CinematicReadinessConfidenceTrend;
  architectural_readiness_notes: string[];
};

export type CinematicReadinessDeltaTrackingRecord = {
  tracking_id: string;
  source: "local-readiness-validation" | "local-execution-sandbox" | "runtime-activation-simulation" | "controlled-local-inference-bootstrap" | "gated-inference-activation-precursor" | "dry-inference-warmup-single-frame-precursor" | "gated-single-frame-dry-execution-path" | "governed-single-frame-synthesis-preparation" | "governed-low-resolution-frame-synthesis-sandbox";
  recorded_at: string;
  milestones: CinematicReadinessMilestoneDelta[];
};

export type CinematicLocalRendererLifecycleStateName =
  | "runtime_idle"
  | "runtime_preparing"
  | "model_loading"
  | "resource_allocating"
  | "frame_pipeline_ready"
  | "rendering_simulated"
  | "packaging_simulated"
  | "archival_ready"
  | "runtime_recovering"
  | "runtime_blocked";

export type CinematicLocalRendererLifecycleState = {
  state: CinematicLocalRendererLifecycleStateName;
  order: number;
  simulated: true;
  detail: string;
  blockers: string[];
};

export type CinematicGpuPressureLevel = "low" | "medium" | "high" | "critical";

export type CinematicGpuAllocationModel = {
  estimated_vram_required_gb: number;
  available_vram_gb: number;
  vram_pressure: CinematicGpuPressureLevel;
  render_concurrency_viable: boolean;
  max_safe_concurrency: number;
  queue_starvation_risk: "low" | "medium" | "high";
  low_vram_fallback_viable: boolean;
  local_cache_pressure: CinematicGpuPressureLevel;
  storage_expansion_risk: "low" | "medium" | "high";
  notes: string[];
};

export type CinematicLocalQueueSimulationState = "queued" | "blocked" | "ready" | "retry-isolated" | "completed-simulated";

export type CinematicLocalQueueSimulationJob = {
  job_id: string;
  shot_id: string;
  state: CinematicLocalQueueSimulationState;
  dependency_job_ids: string[];
  continuity_priority: "low" | "medium" | "high";
  retry_isolated: boolean;
  blocked_reason: string | null;
};

export type CinematicLocalQueueSimulationPlan = {
  queued_jobs: CinematicLocalQueueSimulationJob[];
  dependency_order_job_ids: string[];
  continuity_priority_job_ids: string[];
  blocked_job_ids: string[];
  recovery_sequence_job_ids: string[];
};

export type CinematicRendererRecoveryCause =
  | "failed-render-stage"
  | "insufficient-vram"
  | "dependency-mismatch"
  | "storage-exhaustion"
  | "runtime-corruption"
  | "continuity-state-recovery";

export type CinematicRendererRecoveryStep = {
  cause: CinematicRendererRecoveryCause;
  detail: string;
  sequence_order: number;
};

export type CinematicRendererRecoveryPlan = {
  blocked: boolean;
  causes: CinematicRendererRecoveryCause[];
  steps: CinematicRendererRecoveryStep[];
};

export type CinematicHybridEscalationSimulation = {
  local_first_rendering: boolean;
  cloud_escalation_fallback: boolean;
  offline_safe_execution: boolean;
  premium_provider_escalation: boolean;
  continuity_preserving_escalation: boolean;
  selected_strategy_id: CinematicHybridStrategyId | null;
  selected_routing_mode: CinematicProviderRoutingMode;
  reasons: string[];
};

export type CinematicLocalExecutionSandboxValidation = {
  readiness: CinematicLocalInferenceReadinessReport;
  readiness_delta: CinematicReadinessDeltaTrackingRecord;
  renderer_lifecycle_states: CinematicLocalRendererLifecycleState[];
  gpu_allocation: CinematicGpuAllocationModel;
  queue_plan: CinematicLocalQueueSimulationPlan;
  recovery_plan: CinematicRendererRecoveryPlan;
  hybrid_escalation: CinematicHybridEscalationSimulation;
  execution_enabled: false;
};

export type CinematicLocalInferenceExecutionSandboxResult = {
  validation: CinematicLocalExecutionSandboxValidation;
  simulation: CinematicSandboxSimulationRecord;
};

export type CinematicFrameGenerationPipelinePlan = {
  stages: CinematicFrameGenerationStage[];
  blocked_stage_ids: string[];
  continuity_critical_stage_ids: string[];
  readiness_percentage: number;
  notes: string[];
};

export type CinematicRuntimeConstraintAssessment = {
  selected_constraint_model_id: string | null;
  probe_snapshot_id: string | null;
  preferred_hardware_profile_id: string | null;
  limitations: string[];
  recommendations: string[];
};

export type CinematicHybridRoutingStrategyPlan = {
  selected_strategy_id: CinematicHybridStrategyId | null;
  routing_mode: CinematicProviderRoutingMode;
  fallback_provider: Exclude<CinematicGenerationProvider, "LocalFutureProvider">;
  reasons: string[];
  candidate_strategy_ids: CinematicHybridStrategyId[];
  milestone_progress: CinematicReadinessMilestoneProgress[];
};

export type CinematicSandboxSimulationResult = {
  simulation: CinematicSandboxSimulationRecord;
  jobs: CinematicGenerationJob[];
  history_entries: CinematicGenerationJobHistoryEntry[];
  retry_jobs: CinematicGenerationJob[];
};

export type CinematicProductionMemoryRecord = {
  schema_version: 1;
  created_at: string;
  updated_at: string;
  project_key: string;
  mission_layer: string;
  roadmap_systems: ProductionMemoryManagerSystem[];
  characters: CinematicCharacterProfile[];
  environments: CinematicEnvironmentProfile[];
  story_beats: CinematicStoryBeat[];
  emotional_tone: string[];
  visual_style: string[];
  camera_language: string[];
  lighting: string[];
  props: string[];
  continuity_rules: string[];
  scene_sequences: CinematicSceneSequence[];
  gameplay_cutscene_triggers: GameplayCutsceneTriggerPlan[];
  shot_history: CinematicShotRecord[];
  generated_assets: CinematicAssetRecord[];
  failed_generations: CinematicGenerationOutcome[];
  successful_generations: CinematicGenerationOutcome[];
  asset_reuse_decisions: string[];
  generation_jobs: CinematicGenerationJob[];
  generation_job_history: CinematicGenerationJobHistoryEntry[];
  execution_approval_tokens: CinematicExecutionApprovalToken[];
  approval_audit_trail: CinematicApprovalAuditEntry[];
  budget_governance_decisions: CinematicBudgetGovernanceDecision[];
  continuity_review_notes: CinematicContinuityReviewNote[];
  deferred_execution_plans: CinematicDeferredExecutionPlan[];
  provider_capability_registry: CinematicProviderCapability[];
  local_model_registry: CinematicLocalVideoModelProfile[];
  local_model_loader_registry: CinematicLocalModelLoaderRecord[];
  local_runtime_capability_registry: CinematicLocalRuntimeCapability[];
  controlled_runtime_profiles: CinematicControlledRuntimeProfile[];
  activation_authority_registry: CinematicActivationAuthorityRegistryEntry[];
  execution_temperature_state_history: CinematicExecutionTemperatureStateRecord[];
  local_hardware_profiles: CinematicLocalHardwareProfile[];
  local_runtime_readiness_rules: string[];
  local_provider_routing_rules: string[];
  local_inference_governance_rules: string[];
  local_asset_cache_strategy: string[];
  local_inference_notes: string[];
  local_runtime_probe_path_hints: CinematicRuntimeProbePathHints;
  local_runtime_probe_snapshots: CinematicRuntimeProbeSnapshot[];
  frame_generation_stage_registry: CinematicFrameGenerationStage[];
  renderer_capability_roadmap: CinematicRendererCapabilityRoadmapEntry[];
  runtime_constraint_models: CinematicRuntimeConstraintModel[];
  hybrid_local_cloud_strategies: CinematicHybridLocalCloudStrategy[];
  readiness_delta_tracking_history: CinematicReadinessDeltaTrackingRecord[];
  execution_boundary_status_history: CinematicExecutionBoundaryState[];
  pre_inference_gate_validation_history: CinematicPreInferenceGateValidation[];
  inference_entry_sequencing_history: CinematicInferenceEntrySequencing[];
  forbidden_execution_state_history: CinematicForbiddenExecutionStateEnforcement[];
  governance_escalation_modeling_history: CinematicGovernanceEscalationModeling[];
  future_unlock_conditions_history: CinematicFutureUnlockConditions[];
  dry_inference_warmup_history: CinematicDryInferenceWarmup[];
  single_frame_execution_precursor_history: CinematicSingleFrameExecutionPrecursor[];
  frame_stage_readiness_history: CinematicFrameStageReadinessValidation[];
  warmup_escalation_modeling_history: CinematicWarmupEscalationModeling[];
  future_bounded_execution_rules_history: CinematicFutureBoundedExecutionRules[];
  dry_execution_token_registry_history: CinematicDryExecutionTokenRegistryEntry[][];
  single_frame_dry_execution_path_history: CinematicSingleFrameDryExecutionPath[];
  frame_traversal_validation_history: CinematicFrameTraversalValidation[];
  dry_execution_recovery_history: CinematicDryExecutionRecoveryModeling[];
  future_frame_synthesis_unlocks_history: CinematicFutureFrameSynthesisUnlocks[];
  execution_attempt_ledger_history: CinematicExecutionAttemptLedger[];
  synthesis_containment_registry_history: CinematicSynthesisContainmentRegistryEntry[][];
  governed_synthesis_preparation_history: CinematicGovernedSynthesisPreparationPath[];
  synthesis_validation_layer_history: CinematicSynthesisValidationLayer[];
  contained_escalation_modeling_history: CinematicContainedEscalationModeling[];
  future_low_resolution_output_history: CinematicFutureLowResolutionOutputScaffolding[];
  governed_rollback_ledger_history: CinematicGovernedRollbackLedger[];
  real_output_authorization_registry_history: CinematicRealOutputAuthorizationRegistryEntry[][];
  governed_low_resolution_sandbox_history: CinematicGovernedLowResolutionSandbox[];
  first_real_synthesis_path_history: CinematicFirstRealSynthesisPath[];
  output_containment_validation_history: CinematicOutputContainmentValidation[];
  real_output_rollback_history: CinematicRealOutputRollbackLayer[];
  future_renderer_escalation_history: CinematicFutureRendererEscalationScaffolding[];
  provider_routing_rules: string[];
  prompt_normalization_rules: string[];
  provider_validation_rules: string[];
  generation_budget_policy: CinematicGenerationBudgetPolicy;
  generation_budget_rules: string[];
  manual_approval_workflow: string[];
  execution_lifecycle_rules: string[];
  retry_planning_rules: string[];
  cost_aware_generation_strategy: string[];
  cost_forecast_examples: string[];
  provider_payload_examples: string[];
  sandbox_simulations: CinematicSandboxSimulationRecord[];
  edit_decisions: string[];
  pacing_notes: string[];
  gameplay_context: CinematicGameplayContext;
  cost_aware_iteration_notes: string[];
};

export type CinematicProductionMemoryInitialization = {
  repoRoot: string;
  productionMemoryPath: string;
  record: CinematicProductionMemoryRecord;
};

export type CompiledCinematicShotPrompt = {
  shot_id: string;
  project_key: string;
  beat_id: string;
  sequence_id?: string;
  prompt: string;
  continuity_constraints: string[];
  asset_reuse_candidates: string[];
  prior_shot_context: string | null;
  gameplay_transition_context: string[];
  estimated_cost_tier: CostTier;
};

export type PlannedSequenceResult = {
  sequence: CinematicSceneSequence;
  persisted: boolean;
};

export type ContinuityValidationCategory =
  | "character-continuity"
  | "environment-continuity"
  | "lighting-continuity"
  | "prop-continuity"
  | "tone-continuity"
  | "camera-continuity"
  | "timeline-consistency";

export type ContinuityValidationMismatch = {
  category: ContinuityValidationCategory;
  shot_id: string;
  detail: string;
};

export type ContinuityValidationResult = {
  sequence_id: string;
  valid: boolean;
  mismatches: ContinuityValidationMismatch[];
};

export type FailedShotRegenerationPlan = {
  sequence_id: string;
  failed_shot_ids: string[];
  preserved_successful_shot_ids: string[];
  continuity_state: string[];
};

const MAX_GENERATION_RETRY_COUNT = 2;
const DEFAULT_TARGET_DURATION_SECONDS = 8;
const DEFAULT_TARGET_RESOLUTION: CinematicVideoResolution = "1080p";
const DEFAULT_TARGET_FRAME_RATE = 24;

const DEFAULT_PRODUCTION_MEMORY_RECORD: CinematicProductionMemoryRecord = {
  schema_version: 1,
  created_at: DEFAULT_CREATED_AT,
  updated_at: DEFAULT_CREATED_AT,
  project_key: "babylon-2026",
  mission_layer: "Persistent Production Memory + Cinematic Video Intelligence",
  roadmap_systems: [
    {
      id: "production-memory-manager",
      title: "Production Memory Manager",
      status: "foundation",
      summary: "Persist characters, beats, style, continuity, and iteration outcomes as bounded production memory.",
    },
    {
      id: "scene-graph-builder",
      title: "Scene Graph Builder",
      status: "planned",
      summary: "Map playable scenes, cinematic spaces, and asset relationships into reusable scene context.",
    },
    {
      id: "shot-planner",
      title: "Shot Planner",
      status: "planned",
      summary: "Turn story beats and gameplay triggers into explicit shot plans with framing and pacing.",
    },
    {
      id: "trailer-cutscene-director",
      title: "Trailer/Cutscene Director",
      status: "planned",
      summary: "Sequence beats, reveals, and gameplay-cinematic transitions into a coherent directing pass.",
    },
    {
      id: "continuity-checker",
      title: "Continuity Checker",
      status: "planned",
      summary: "Guard tone, prop, costume, geography, and gameplay state continuity across generations.",
    },
    {
      id: "asset-reuse-tracker",
      title: "Asset Reuse Tracker",
      status: "planned",
      summary: "Track reusable shots, prompts, edits, and source assets to reduce drift and cost.",
    },
    {
      id: "gameplay-cutscene-trigger-system",
      title: "Gameplay Cutscene Trigger System",
      status: "planned",
      summary: "Bind gameplay conditions and state changes to cinematic beat activation points.",
    },
    {
      id: "cinematic-prompt-compiler",
      title: "Cinematic Prompt Compiler",
      status: "foundation",
      summary: "Compile production memory into structured shot prompts without invoking generation yet.",
    },
    {
      id: "cost-aware-iteration-system",
      title: "Cost-Aware Iteration System",
      status: "planned",
      summary: "Record failed/successful attempts with cost tiers and prioritize bounded iteration loops.",
    },
    {
      id: "cinematic-execution-sandbox",
      title: "Cinematic Execution Sandbox",
      status: "foundation",
      summary: "Prepare provider-agnostic cinematic generation jobs and sandbox execution lifecycle transitions without real API calls.",
    },
    {
      id: "provider-routing-layer",
      title: "Provider Routing Layer",
      status: "planned",
      summary: "Choose draft, premium, offline, and future-local generation routes without locking to one provider.",
    },
    {
      id: "shot-batch-orchestrator",
      title: "Shot Batch Orchestrator",
      status: "planned",
      summary: "Group execution jobs into continuity-safe shot batches with reusable environment and character context.",
    },
    {
      id: "generation-lifecycle-tracker",
      title: "Generation Lifecycle Tracker",
      status: "planned",
      summary: "Track append-only execution lifecycle state transitions for cinematic jobs and retry flows.",
    },
    {
      id: "cinematic-prompt-compiler",
      title: "Cinematic Prompt Compiler",
      status: "foundation",
      summary: "Compile production memory into structured shot prompts without invoking generation yet.",
    },
    {
      id: "second-brain-obsidian-integration",
      title: "Second Brain + Obsidian integration",
      status: "foundation",
      summary: "Export human-readable cinematic planning notes while keeping machine memory authoritative.",
    },
  ],
  characters: [
    {
      character_id: "babylon-protagonist",
      name: "BABYLON Runner",
      role: "player-avatar",
      visual_signature: ["compact armored silhouette", "clear traversal gear", "high contrast gameplay readability"],
      emotional_range: ["resolve", "pressure", "recovery"],
      continuity_rules: ["Keep silhouette readable in gameplay and cinematic framing.", "Do not contradict currently implemented player abilities."],
    },
  ],
  environments: [
    {
      environment_id: "babylon-arena-foundation",
      name: "BABYLON Arena Foundation",
      mood: "controlled tension",
      visual_markers: ["clean arena lanes", "clear enemy approach vectors", "combat readability first"],
      lighting_rules: ["Preserve readable player/enemy separation.", "Avoid dramatic darkness that obscures gameplay state."],
      props: ["spawn pads", "weapon pickup silhouettes", "impact debris accents"],
    },
  ],
  story_beats: [
    {
      beat_id: "babylon-cutscene-proof",
      title: "Wave Start Pressure Beat",
      summary: "A short gameplay-adjacent cutscene establishes the next wave as pressure rises before control returns.",
      emotional_goal: "anticipation without losing tactical clarity",
      gameplay_trigger: "wave countdown enters final beat",
      continuity_dependencies: ["Match current arena layout.", "Do not imply weapons or enemies not present in the playable build."],
    },
  ],
  emotional_tone: ["pressured", "readable", "confident", "kinetic", "resolve"],
  visual_style: ["gameplay-first cinematic framing", "clean sci-fi action", "high legibility silhouettes"],
  camera_language: [
    "push-ins for wave reveals",
    "shoulder-height tactical framing",
    "brief hero inserts between combat beats",
    "wide layout-establishing frames for readable arena geography",
    "glide-back gameplay continuity handoffs",
  ],
  lighting: ["rim light for subject separation", "arena practicals over abstract mood lighting"],
  props: ["arena barriers", "weapon silhouettes", "enemy spawn markers"],
  continuity_rules: [
    "Cinematics must respect the live gameplay state and known-good BABYLON systems.",
    "Do not invent props, locations, or powers that the current production case study does not support.",
    "Shot-to-shot lighting must preserve player/enemy readability over dramatic stylization.",
  ],
  scene_sequences: [
    {
      sequence_id: "sequence-wave-transition-001",
      title: "Wave Transition Pressure Sequence",
      beat_id: "babylon-cutscene-proof",
      shots: [
        {
          shot_id: "sequence-wave-transition-001-intro",
          shot_order: 1,
          shot_purpose: "intro-shot",
          emotional_intent: "signal that a controlled cinematic beat is starting",
          gameplay_trigger: "wave countdown enters final beat",
          continuity_dependencies: ["Respect active arena layout."],
          required_assets: ["prompt-wave-reveal-001"],
          camera_behavior: "brief push-in from current gameplay framing",
          transition_notes: "Do not fully break the player's spatial awareness.",
          character_ids: ["babylon-protagonist"],
          environment_id: "babylon-arena-foundation",
          lighting_reference: "arena practicals over abstract mood lighting",
          prop_ids: ["arena barriers", "enemy spawn markers"],
          tone_reference: "pressured",
          timeline_position: 1,
        },
        {
          shot_id: "sequence-wave-transition-001-establish",
          shot_order: 2,
          shot_purpose: "establish-environment",
          emotional_intent: "clarify arena geography before escalation",
          gameplay_trigger: "wave countdown enters final beat",
          continuity_dependencies: ["Keep readable enemy approach vectors."],
          required_assets: ["prompt-wave-reveal-001"],
          camera_behavior: "wide arena reveal with tactical lanes visible",
          transition_notes: "Hold only long enough to confirm geography.",
          character_ids: ["babylon-protagonist"],
          environment_id: "babylon-arena-foundation",
          lighting_reference: "arena practicals over abstract mood lighting",
          prop_ids: ["arena barriers", "spawn pads"],
          tone_reference: "readable",
          timeline_position: 2,
        },
        {
          shot_id: "sequence-wave-transition-001-reveal",
          shot_order: 3,
          shot_purpose: "reveal-subject",
          emotional_intent: "reveal the player as the subject of rising pressure",
          gameplay_trigger: "wave countdown enters final beat",
          continuity_dependencies: ["Preserve player silhouette readability."],
          required_assets: ["prompt-wave-reveal-001"],
          camera_behavior: "shoulder-height tactical framing",
          transition_notes: "Bridge geography into subject focus.",
          character_ids: ["babylon-protagonist"],
          environment_id: "babylon-arena-foundation",
          lighting_reference: "rim light for subject separation",
          prop_ids: ["weapon silhouettes"],
          tone_reference: "confident",
          timeline_position: 3,
        },
        {
          shot_id: "sequence-wave-transition-001-escalation",
          shot_order: 4,
          shot_purpose: "escalation-shot",
          emotional_intent: "raise threat anticipation without obscuring play state",
          gameplay_trigger: "wave countdown enters final beat",
          continuity_dependencies: ["Do not imply enemies outside the playable build."],
          required_assets: ["prompt-wave-reveal-001"],
          camera_behavior: "controlled push-in on threat lane",
          transition_notes: "Escalate pressure just before return.",
          character_ids: ["babylon-protagonist"],
          environment_id: "babylon-arena-foundation",
          lighting_reference: "arena practicals over abstract mood lighting",
          prop_ids: ["enemy spawn markers"],
          tone_reference: "kinetic",
          timeline_position: 4,
        },
        {
          shot_id: "sequence-wave-transition-001-emotional",
          shot_order: 5,
          shot_purpose: "emotional-beat",
          emotional_intent: "lock in resolve before control returns",
          gameplay_trigger: "wave countdown enters final beat",
          continuity_dependencies: ["Keep the player ability read consistent."],
          required_assets: ["prompt-wave-reveal-001"],
          camera_behavior: "brief hero insert",
          transition_notes: "Keep this beat short and controlled.",
          character_ids: ["babylon-protagonist"],
          environment_id: "babylon-arena-foundation",
          lighting_reference: "rim light for subject separation",
          prop_ids: ["weapon silhouettes"],
          tone_reference: "resolve",
          timeline_position: 5,
        },
        {
          shot_id: "sequence-wave-transition-001-transition",
          shot_order: 6,
          shot_purpose: "transition-shot",
          emotional_intent: "prepare a clean handoff back to gameplay",
          gameplay_trigger: "wave countdown enters final beat",
          continuity_dependencies: ["Camera must land near gameplay ownership framing."],
          required_assets: ["prompt-wave-reveal-001"],
          camera_behavior: "decelerate back toward gameplay camera lane",
          transition_notes: "Land on a frame that can return input cleanly.",
          character_ids: ["babylon-protagonist"],
          environment_id: "babylon-arena-foundation",
          lighting_reference: "arena practicals over abstract mood lighting",
          prop_ids: ["arena barriers"],
          tone_reference: "readable",
          timeline_position: 6,
        },
        {
          shot_id: "sequence-wave-transition-001-return",
          shot_order: 7,
          shot_purpose: "gameplay-return",
          emotional_intent: "return agency at peak anticipation",
          gameplay_trigger: "wave countdown completes",
          continuity_dependencies: ["No discontinuity between cinematic and gameplay state."],
          required_assets: ["prompt-wave-reveal-001"],
          camera_behavior: "handoff to gameplay-owned camera framing",
          transition_notes: "Input returns immediately as the wave starts.",
          character_ids: ["babylon-protagonist"],
          environment_id: "babylon-arena-foundation",
          lighting_reference: "arena practicals over abstract mood lighting",
          prop_ids: ["enemy spawn markers", "weapon silhouettes"],
          tone_reference: "pressured",
          timeline_position: 7,
        },
      ],
    },
  ],
  gameplay_cutscene_triggers: [
    {
      trigger_id: "trigger-wave-escalation-001",
      trigger_type: "gameplay-escalation",
      title: "Wave Escalation Transition",
      gameplay_state: "wave countdown active with stable arena state",
      cinematic_state: "brief anticipation sequence before control returns",
      activation_conditions: ["wave countdown in final beat", "player alive", "camera ownership stable"],
      target_sequence_id: "sequence-wave-transition-001",
      transition_notes: ["Keep the beat under a few seconds.", "Return to gameplay with no camera discontinuity."],
    },
    {
      trigger_id: "trigger-boss-intro-001",
      trigger_type: "boss-intro",
      title: "Boss Intro Planning Placeholder",
      gameplay_state: "boss encounter threshold reached",
      cinematic_state: "brief reveal of boss threat and player framing",
      activation_conditions: ["boss enabled in production build", "arena state locked", "operator-approved sequence exists"],
      target_sequence_id: "sequence-wave-transition-001",
      transition_notes: ["Planning-only until a dedicated boss sequence exists."],
    },
  ],
  shot_history: [
    {
      shot_id: "shot-wave-reveal-001",
      recorded_at: DEFAULT_CREATED_AT,
      beat_id: "babylon-cutscene-proof",
      intent: "Establish incoming pressure before the next combat loop.",
      camera_framing: "wide arena reveal",
      camera_motion: "slow push-in",
      lens_language: "24mm gameplay-aware environment read",
      lighting_direction: "practicals plus subject rim separation",
      outcome: "baseline planning only",
    },
  ],
  generated_assets: [
    {
      asset_id: "prompt-wave-reveal-001",
      kind: "prompt",
      label: "Wave reveal planning prompt",
      source: "ai-e cinematic production memory foundation",
      reusable: true,
      reuse_notes: ["Use as a baseline for countdown-to-wave reveal beats."],
    },
  ],
  asset_reuse_decisions: [
    "Preserve the approved wave reveal prompt when only the escalation insert fails.",
    "Reuse environment-establishing shots before generating new geography coverage.",
  ],
  generation_jobs: [],
  generation_job_history: [],
  execution_approval_tokens: [],
  approval_audit_trail: [],
  budget_governance_decisions: [],
  continuity_review_notes: [],
  deferred_execution_plans: [],
  provider_capability_registry: [
    {
      provider: "Sora",
      max_duration_seconds: 20,
      max_prompt_characters: 4000,
      supported_resolutions: ["720p", "1080p", "1440p"],
      supported_frame_rates: [24, 30],
      continuity_support: "full",
      image_reference_support: true,
      max_image_references: 4,
      estimated_cost_profile: { draft: 6, standard: 10, premium: 16 },
      queue_behavior: "Premium queue with slower turnaround but higher fidelity.",
      retry_recommendation: "Prefer one targeted retry after continuity simplification.",
    },
    {
      provider: "Seedance",
      max_duration_seconds: 8,
      max_prompt_characters: 1800,
      supported_resolutions: ["720p", "1080p"],
      supported_frame_rates: [24, 30],
      continuity_support: "partial",
      image_reference_support: true,
      max_image_references: 2,
      estimated_cost_profile: { draft: 2, standard: 4, premium: 7 },
      queue_behavior: "Fast draft queue optimized for storyboard-grade passes.",
      retry_recommendation: "Use one cheap retry before escalating to a premium provider.",
    },
    {
      provider: "Runway",
      max_duration_seconds: 10,
      max_prompt_characters: 2200,
      supported_resolutions: ["720p", "1080p"],
      supported_frame_rates: [24, 30],
      continuity_support: "partial",
      image_reference_support: true,
      max_image_references: 3,
      estimated_cost_profile: { draft: 3, standard: 6, premium: 11 },
      queue_behavior: "Shared queue with balanced latency and comparison-friendly payloads.",
      retry_recommendation: "Retry once with fewer references if validation pressure is high.",
    },
    {
      provider: "Veo",
      max_duration_seconds: 12,
      max_prompt_characters: 3200,
      supported_resolutions: ["720p", "1080p", "4k"],
      supported_frame_rates: [24, 30],
      continuity_support: "full",
      image_reference_support: true,
      max_image_references: 5,
      estimated_cost_profile: { draft: 5, standard: 9, premium: 15 },
      queue_behavior: "Balanced premium queue for comparison-grade cinematic passes.",
      retry_recommendation: "Allow up to two targeted retries when continuity context remains stable.",
    },
    {
      provider: "LocalFutureProvider",
      max_duration_seconds: 16,
      max_prompt_characters: 5000,
      supported_resolutions: ["720p", "1080p", "1440p"],
      supported_frame_rates: [24, 30, 60],
      continuity_support: "limited",
      image_reference_support: true,
      max_image_references: 4,
      estimated_cost_profile: { draft: 1, standard: 3, premium: 5 },
      queue_behavior: "Offline local queue reserved for future generator-agnostic bridge validation.",
      retry_recommendation: "Use only after provider payloads are validated and manual approval is explicit.",
    },
  ],
  local_model_registry: [
    {
      model_id: "wan-2.1-t2v-q8",
      display_name: "Wan 2.1 Text-to-Video Q8",
      backend_family: "wan",
      generation_mode: "text-to-video",
      status: "candidate",
      supported_resolutions: ["720p", "1080p"],
      max_duration_seconds: 6,
      continuity_support: "partial",
      vram_requirement_gb: 12,
      storage_requirement_gb: 28,
      quantization_profiles: ["q8", "q6"],
      notes: [
        "Primary local candidate for future Windows-friendly text-to-video trials.",
        "Requires explicit operator review before any future runtime binding is considered.",
      ],
    },
    {
      model_id: "ltx-video-img2vid-int8",
      display_name: "LTX Video Image-to-Video INT8",
      backend_family: "ltx-video",
      generation_mode: "image-to-video",
      status: "candidate",
      supported_resolutions: ["720p", "1080p"],
      max_duration_seconds: 8,
      continuity_support: "limited",
      vram_requirement_gb: 10,
      storage_requirement_gb: 24,
      quantization_profiles: ["int8", "fp16"],
      notes: [
        "Useful for reference-driven motion continuation once local cache strategy is mature.",
        "Treat as advisory only until runtime detection and hardware profiling are both stable.",
      ],
    },
    {
      model_id: "hunyuan-video-13b-planned",
      display_name: "Hunyuan Video 13B Planned Slot",
      backend_family: "hunyuan-video",
      generation_mode: "text-to-video",
      status: "download-planned",
      supported_resolutions: ["720p"],
      max_duration_seconds: 5,
      continuity_support: "partial",
      vram_requirement_gb: 16,
      storage_requirement_gb: 42,
      quantization_profiles: ["fp16"],
      notes: [
        "Reserved as a higher-memory future candidate rather than an immediate local target.",
      ],
    },
  ],
  local_model_loader_registry: [
    {
      loader_id: "loader-wan-2.1-t2v-q8",
      model_name: "Wan 2.1 Text-to-Video Q8",
      model_type: "text-to-video",
      model_path: "models/wan-2.1-t2v-q8",
      runtime_target: "comfyui-local-video-lane",
      estimated_vram: 12,
      estimated_load_time: 45,
      dependency_requirements: ["python-runtime", "comfyui-runtime", "model-weights", "ffmpeg"],
      supported_resolution: ["720p", "1080p"],
      supported_duration: 6,
      continuity_support: "partial",
      offline_viability: true,
      status: "registered",
    },
    {
      loader_id: "loader-ltx-video-img2vid-int8",
      model_name: "LTX Video Image-to-Video INT8",
      model_type: "image-to-video",
      model_path: "models/ltx-video-img2vid-int8",
      runtime_target: "diffusers-python-pipeline",
      estimated_vram: 10,
      estimated_load_time: 35,
      dependency_requirements: ["python-runtime", "diffusers-runtime", "model-weights"],
      supported_resolution: ["720p", "1080p"],
      supported_duration: 8,
      continuity_support: "limited",
      offline_viability: true,
      status: "dependency-review",
    },
    {
      loader_id: "loader-hunyuan-video-13b-planned",
      model_name: "Hunyuan Video 13B Planned Slot",
      model_type: "text-to-video",
      model_path: "models/hunyuan-video-13b-planned",
      runtime_target: "comfyui-local-video-lane",
      estimated_vram: 16,
      estimated_load_time: 80,
      dependency_requirements: ["python-runtime", "comfyui-runtime", "model-weights", "cuda-runtime"],
      supported_resolution: ["720p"],
      supported_duration: 5,
      continuity_support: "partial",
      offline_viability: false,
      status: "blocked",
    },
  ],
  controlled_runtime_profiles: [
    {
      profile_id: "low_vram_safe",
      display_name: "Low VRAM Safe",
      summary: "Favor serialized, low-footprint dry initialization checks when VRAM headroom is constrained.",
      routing_mode: "offline-planning-mode",
      governance_notes: ["Keep VRAM reservation dry only.", "Do not promote beyond dry initialization while VRAM blockers remain."],
    },
    {
      profile_id: "offline_safe",
      display_name: "Offline Safe",
      summary: "Prefer bounded offline bootstrap validation when local-only readiness is still incomplete.",
      routing_mode: "offline-planning-mode",
      governance_notes: ["No network dependency should be introduced.", "Execution remains blocked even if bootstrap checks pass."],
    },
    {
      profile_id: "continuity_priority",
      display_name: "Continuity Priority",
      summary: "Bias future bridge planning toward continuity-preserving loaders and pipelines.",
      routing_mode: "future-local-inference-mode",
      governance_notes: ["Continuity blockers override speed optimizations.", "Rendering remains disabled until continuity-safe activation is reviewed."],
    },
    {
      profile_id: "cloud_hybrid_safe",
      display_name: "Cloud Hybrid Safe",
      summary: "Preserve a safe cloud-hybrid fallback when local bootstrap integrity remains incomplete.",
      routing_mode: "balanced-comparison-mode",
      governance_notes: ["Hybrid planning must remain advisory only.", "Do not bypass local governance or approval flow."],
    },
    {
      profile_id: "cpu_fallback_safe",
      display_name: "CPU Fallback Safe",
      summary: "Keep a non-accelerated fallback profile visible for conservative dry initialization planning.",
      routing_mode: "offline-planning-mode",
      governance_notes: ["CPU fallback is planning-only for this layer.", "No inference or rendering may start from the fallback profile."],
    },
  ],
  activation_authority_registry: [],
  execution_temperature_state_history: [],
  local_runtime_capability_registry: [
    {
      runtime_id: "comfyui-local-video-lane",
      display_name: "ComfyUI Local Video Lane",
      runtime_family: "comfyui",
      status: "configured",
      detection_method: "path-config",
      supported_backends: ["cuda", "directml"],
      concurrent_job_limit: 1,
      supports_asset_cache: true,
      supports_operator_review_handoff: true,
      notes: [
        "Configured as a future manual bridge target only.",
        "Readiness helpers must not launch or probe this runtime automatically.",
      ],
    },
    {
      runtime_id: "diffusers-python-pipeline",
      display_name: "Diffusers Python Pipeline",
      runtime_family: "diffusers",
      status: "candidate",
      detection_method: "future-runtime-probe",
      supported_backends: ["cuda", "cpu"],
      concurrent_job_limit: 1,
      supports_asset_cache: true,
      supports_operator_review_handoff: true,
      notes: [
        "Kept as a secondary compatibility path for scripted local backend experiments.",
      ],
    },
  ],
  local_hardware_profiles: [
    {
      profile_id: "windows-directml-baseline",
      display_name: "Windows DirectML Baseline",
      status: "profiled",
      accelerator_backend: "directml",
      gpu_name: "Planned workstation GPU",
      gpu_vram_gb: 12,
      system_ram_gb: 32,
      storage_free_gb: 180,
      encoder_support: ["h264", "h265"],
      recommended_max_resolution: "1080p",
      recommended_max_duration_seconds: 6,
      notes: [
        "Targets the first Windows-native local backend lane without assuming CUDA exclusivity.",
      ],
    },
    {
      profile_id: "cpu-fallback-planning",
      display_name: "CPU Fallback Planning",
      status: "planned",
      accelerator_backend: "cpu",
      gpu_name: "none",
      gpu_vram_gb: 0,
      system_ram_gb: 32,
      storage_free_gb: 120,
      encoder_support: ["h264"],
      recommended_max_resolution: "720p",
      recommended_max_duration_seconds: 3,
      notes: [
        "Fallback planning profile only; not suitable for primary local render expectations.",
      ],
    },
  ],
  local_runtime_readiness_rules: [
    "Local runtime detection remains advisory and must not launch external runtimes automatically.",
    "At least one configured or detected runtime, one profiled hardware target, and one candidate model must exist before local bridge review.",
    "Readiness reports must preserve sandbox-only mode until an operator explicitly authorizes a future local execution bridge.",
  ],
  local_provider_routing_rules: [
    "Prefer LocalFutureProvider only when runtime, model, and hardware checks pass for the requested shot profile.",
    "Fall back to offline-planning-mode or cloud provider comparison when local readiness is incomplete.",
    "High continuity or long-duration shots should prefer cloud review until local model support is explicitly profiled.",
  ],
  local_inference_governance_rules: [
    "Local execution planning remains manual-only and non-autonomous.",
    "No runtime launch, model download, or render job may happen from readiness helpers.",
    "Append-only approval and continuity governance must remain unchanged before any future local bridge is considered.",
  ],
  local_asset_cache_strategy: [
    "Cache model weights and VAE assets separately from generated outputs.",
    "Store reusable reference frames and conditioning assets with deterministic fingerprints.",
    "Treat local cache eviction as an operator-reviewed storage decision, not an automatic background process.",
  ],
  local_inference_notes: [
    "Use LocalFutureProvider as a stable abstraction over future open-source backends.",
    "Keep runtime detection, hardware profiling, and model registry decoupled so routing stays provider-agnostic.",
    "Plan for Windows-friendly backends first, with DirectML and CUDA both representable in the readiness layer.",
  ],
  local_runtime_probe_path_hints: {
    cuda_paths: [
      "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA",
      "C:/Program Files/NVIDIA GPU Computing Toolkit",
    ],
    ffmpeg_paths: [
      "C:/ffmpeg/bin/ffmpeg.exe",
      "C:/Program Files/ffmpeg/bin/ffmpeg.exe",
    ],
    python_paths: [
      ".venv/Scripts/python.exe",
      "C:/Python312/python.exe",
      "C:/Python311/python.exe",
    ],
    inference_runtime_paths: [
      "ComfyUI",
      ".venv/Lib/site-packages/diffusers",
      ".venv/Lib/site-packages/torch",
    ],
    local_model_paths: [
      "models",
      "data/models",
      "runner_artifacts/models",
    ],
  },
  local_runtime_probe_snapshots: [],
  frame_generation_stage_registry: [
    {
      stage_id: "prompt-compilation",
      display_name: "Prompt Compilation",
      status: "foundation",
      description: "Compile bounded cinematic intent into a future local frame-generation payload.",
      dependencies: ["cinematic production memory", "provider payload normalization"],
      continuity_critical: true,
      notes: ["Already aligned with LocalFutureProvider planning payload preparation."],
    },
    {
      stage_id: "latent-preparation",
      display_name: "Latent Preparation",
      status: "modeled",
      description: "Reserve a future stage for seed selection, conditioning tensors, and reusable latent context.",
      dependencies: ["runtime probe results", "model registry"],
      continuity_critical: true,
      notes: ["Modeled only; no latent generation or runtime execution occurs in this phase."],
    },
    {
      stage_id: "frame-synthesis",
      display_name: "Frame Synthesis",
      status: "planned",
      description: "Future synthesis stage for local frame generation once a manual-only execution bridge exists.",
      dependencies: ["local runtime readiness", "manual approval bridge"],
      continuity_critical: true,
      notes: ["Explicitly blocked from execution in this milestone."],
    },
    {
      stage_id: "frame-interpolation",
      display_name: "Frame Interpolation",
      status: "planned",
      description: "Future optional stage for smoothing sparse local frame sequences.",
      dependencies: ["renderer capability roadmap", "runtime constraint models"],
      continuity_critical: false,
      notes: ["Planning-only interpolation lane."],
    },
    {
      stage_id: "temporal-continuity",
      display_name: "Temporal Continuity",
      status: "modeled",
      description: "Model the continuity-state handoff required to keep local sequences coherent across frames and shots.",
      dependencies: ["continuity rules", "renderer continuity-state reuse"],
      continuity_critical: true,
      notes: ["Critical to any future local generation lane."],
    },
    {
      stage_id: "upscale-stage",
      display_name: "Upscale Stage",
      status: "planned",
      description: "Future local upscale planning for draft-to-review quality transitions.",
      dependencies: ["renderer capability roadmap", "runtime probe ffmpeg/python support"],
      continuity_critical: false,
      notes: ["No upscaling runtime is launched in this phase."],
    },
    {
      stage_id: "render-packaging",
      display_name: "Render Packaging",
      status: "modeled",
      description: "Package future image sequences, sidecar metadata, and continuity notes into reviewable outputs.",
      dependencies: ["ffmpeg availability", "offline packaging roadmap"],
      continuity_critical: false,
      notes: ["Covers non-executing packaging metadata only."],
    },
    {
      stage_id: "output-archival",
      display_name: "Output Archival",
      status: "foundation",
      description: "Reuse append-only governance and asset archival rules for any future local outputs.",
      dependencies: ["approval audit trail", "asset cache strategy"],
      continuity_critical: true,
      notes: ["Archival remains append-only and operator-governed."],
    },
  ],
  renderer_capability_roadmap: [
    {
      capability_id: "image-sequence-rendering",
      display_name: "Image Sequence Rendering",
      status: "modeled",
      description: "Plan future image-sequence assembly from locally generated frame sets.",
      dependencies: ["frame synthesis", "render packaging"],
      notes: ["No renderer execution is enabled."],
    },
    {
      capability_id: "frame-interpolation",
      display_name: "Frame Interpolation",
      status: "planned",
      description: "Future interpolation lane for smoothing sparse local frame outputs.",
      dependencies: ["frame interpolation", "runtime constraints"],
      notes: ["Planning-only stage."],
    },
    {
      capability_id: "temporal-coherence",
      display_name: "Temporal Coherence",
      status: "modeled",
      description: "Preserve consistent visual state across successive frames and shots.",
      dependencies: ["temporal continuity", "continuity validation"],
      notes: ["Continuity-first requirement."],
    },
    {
      capability_id: "continuity-state-reuse",
      display_name: "Continuity-State Reuse",
      status: "modeled",
      description: "Reuse bounded state between local draft passes and premium cloud escalation.",
      dependencies: ["asset reuse tracker", "continuity notes"],
      notes: ["Remains non-executing."],
    },
    {
      capability_id: "local-upscaling",
      display_name: "Local Upscaling",
      status: "planned",
      description: "Future operator-approved upscale stage for local draft outputs.",
      dependencies: ["upscale stage", "runtime probe ffmpeg/python support"],
      notes: ["No upscale runtime activation in this phase."],
    },
    {
      capability_id: "offline-packaging",
      display_name: "Offline Packaging",
      status: "foundation",
      description: "Prepare non-executing packaging rules for outputs, metadata, and archival manifests.",
      dependencies: ["render packaging", "output archival"],
      notes: ["Packaging plans stay offline-safe."],
    },
  ],
  runtime_constraint_models: [
    {
      model_id: "windows-local-runtime-baseline",
      title: "Windows Local Runtime Baseline",
      minimum_vram_tiers_gb: [8, 12, 16],
      low_vram_fallback_viable: true,
      storage_scaling: [
        "Draft local lanes should reserve at least 24GB for weights and cache.",
        "Higher-continuity models should reserve 40GB+ once multi-stage packaging is introduced.",
      ],
      render_time_scaling: [
        "720p draft passes should be treated as the baseline timing tier.",
        "1080p multi-stage passes may take roughly 2x the baseline planning estimate.",
      ],
      local_queue_pressure: [
        "Single-job local queues remain the default assumption.",
        "Queued local packaging and upscale stages should be serialized until runtime evidence improves.",
      ],
      hybrid_offload_recommendations: [
        "Offload premium or long-duration shots to cloud providers when local VRAM or storage is tight.",
        "Use local draft previews first when budget pressure is higher than fidelity pressure.",
      ],
    },
  ],
  hybrid_local_cloud_strategies: [
    {
      strategy_id: "local-draft-rendering",
      display_name: "Local Draft Rendering",
      status: "foundation",
      summary: "Reserve local inference for future low-cost draft passes after runtime readiness improves.",
      preferred_provider_mode: "future-local-inference-mode",
      governance_requirements: ["manual approval", "sandbox-only until bridge approval"],
      escalation_conditions: ["runtime readiness incomplete", "continuity pressure exceeds local support"],
    },
    {
      strategy_id: "cloud-premium-rendering",
      display_name: "Cloud Premium Rendering",
      status: "foundation",
      summary: "Use cloud providers for premium fidelity and longer continuity-sensitive renders.",
      preferred_provider_mode: "premium-cinematic-provider",
      governance_requirements: ["manual approval", "budget governance"],
      escalation_conditions: ["premium fidelity required", "local hardware below model thresholds"],
    },
    {
      strategy_id: "offline-safe-mode",
      display_name: "Offline Safe Mode",
      status: "foundation",
      summary: "Keep orchestration and planning provider-agnostic without invoking any runtime or provider execution.",
      preferred_provider_mode: "offline-planning-mode",
      governance_requirements: ["sandbox-only mode", "no runtime launch"],
      escalation_conditions: ["runtime probes missing", "operator requests planning-only review"],
    },
    {
      strategy_id: "continuity-first-routing",
      display_name: "Continuity-First Routing",
      status: "modeled",
      summary: "Escalate to the highest continuity-preserving lane when sequence coherence is at risk.",
      preferred_provider_mode: "premium-cinematic-provider",
      governance_requirements: ["continuity validation", "operator review"],
      escalation_conditions: ["temporal continuity stage incomplete", "local model continuity support limited"],
    },
    {
      strategy_id: "budget-first-routing",
      display_name: "Budget-First Routing",
      status: "modeled",
      summary: "Prefer cheaper local or draft-capable lanes when cost pressure dominates fidelity pressure.",
      preferred_provider_mode: "cheap-draft-provider",
      governance_requirements: ["budget governance", "manual approval"],
      escalation_conditions: ["budget cap exceeded", "storage or queue pressure rises"],
    },
    {
      strategy_id: "hardware-aware-escalation",
      display_name: "Hardware-Aware Escalation",
      status: "modeled",
      summary: "Escalate from local to cloud when hardware evidence cannot support the requested render profile.",
      preferred_provider_mode: "balanced-comparison-mode",
      governance_requirements: ["runtime constraint review", "manual escalation"],
      escalation_conditions: ["low VRAM", "missing ffmpeg", "local runtime not detected"],
    },
  ],
  readiness_delta_tracking_history: [],
  execution_boundary_status_history: [],
  pre_inference_gate_validation_history: [],
  inference_entry_sequencing_history: [],
  forbidden_execution_state_history: [],
  governance_escalation_modeling_history: [],
  future_unlock_conditions_history: [],
  dry_inference_warmup_history: [],
  single_frame_execution_precursor_history: [],
  frame_stage_readiness_history: [],
  warmup_escalation_modeling_history: [],
  future_bounded_execution_rules_history: [],
  dry_execution_token_registry_history: [],
  single_frame_dry_execution_path_history: [],
  frame_traversal_validation_history: [],
  dry_execution_recovery_history: [],
  future_frame_synthesis_unlocks_history: [],
  execution_attempt_ledger_history: [],
  synthesis_containment_registry_history: [],
  governed_synthesis_preparation_history: [],
  synthesis_validation_layer_history: [],
  contained_escalation_modeling_history: [],
  future_low_resolution_output_history: [],
  governed_rollback_ledger_history: [],
  real_output_authorization_registry_history: [],
  governed_low_resolution_sandbox_history: [],
  first_real_synthesis_path_history: [],
  output_containment_validation_history: [],
  real_output_rollback_history: [],
  future_renderer_escalation_history: [],
  provider_routing_rules: [
    "Cheap draft routing should prefer Seedance for low-cost storyboard-grade passes.",
    "Premium cinematic routing should prefer Sora when fidelity matters more than cost.",
    "Offline planning and future local inference modes must remain provider-agnostic and avoid real API calls.",
    "Balanced comparison mode can use Veo or Runway stubs to compare provider-ready payloads without execution lock-in.",
  ],
  prompt_normalization_rules: [
    "Normalize prompts into provider-ready payloads without changing continuity intent.",
    "Trim provider prompts deterministically when prompt limits are exceeded.",
    "Preserve camera, continuity, style, and retry metadata across all provider variants.",
  ],
  provider_validation_rules: [
    "Reject prompts that exceed provider-specific prompt limits.",
    "Reject durations, resolutions, or frame rates outside provider support.",
    "Reject reference counts beyond provider limits or providers without image-reference support.",
    "Reject payloads that demand continuity behavior beyond provider support.",
  ],
  generation_budget_policy: {
    max_shots_per_batch: 8,
    max_retries_per_job: MAX_GENERATION_RETRY_COUNT,
    max_estimated_sequence_cost: 220,
    provider_cooldown_minutes: 10,
    sandbox_only_mode: true,
    manual_approval_required: true,
  },
  generation_budget_rules: [
    "Max shots per batch remains a hard gate before provider handoff.",
    "Retry counts stay bounded to avoid hidden spend loops.",
    "Estimated sequence cost caps block overspend before approval is considered.",
    "Provider cooldowns apply only to explicit provider execution handoff attempts.",
  ],
  manual_approval_workflow: [
    "AI-E may prepare, validate, queue, and estimate generation jobs without provider execution.",
    "A human approval step is required before any provider execution or credit spend is considered valid.",
    "Sandbox-only mode must remain enabled by default for provider bridge preparation.",
  ],
  execution_lifecycle_rules: [
    "Execution lifecycle remains append-only in generation job history.",
    "Continuity validation must pass before any job can advance beyond planned.",
    "Sandbox simulation may transition jobs through queueing, generation, validation, approval, failure, and retry-required states deterministically.",
  ],
  retry_planning_rules: [
    "Retry planning must preserve successful shot outputs and only isolate failed shots when possible.",
    "Retry loops must block once the bounded retry threshold is reached.",
    "Regeneration-only batches should carry preserved output references from successful neighboring shots.",
  ],
  cost_aware_generation_strategy: [
    "Use cheap draft routing for first-pass framing validation.",
    "Use premium cinematic routing for higher-fidelity provider-ready payloads.",
    "Use offline planning mode when only orchestration validation is required.",
    "Reserve future local inference mode for later generator-agnostic local execution bridges.",
  ],
  cost_forecast_examples: [
    "A 7-shot Seedance draft pass should remain cheap enough for validation-first planning.",
    "A premium Sora pass should forecast higher cost but lower payload-compression pressure.",
  ],
  provider_payload_examples: [
    "Sora-ready payloads should keep cinematic prose plus continuity annotations.",
    "Seedance-ready payloads should stay compressed and storyboard-focused.",
    "Veo and Runway payloads should preserve references, camera instructions, and duration targets.",
  ],
  sandbox_simulations: [],
  failed_generations: [
    {
      generation_id: "failed-wave-overstyle-001",
      recorded_at: DEFAULT_CREATED_AT,
      shot_id: "shot-wave-reveal-001",
      status: "failed",
      prompt_summary: "Attempted an overly dark, trailerized reveal that hid gameplay geography.",
      engine: "planning-placeholder",
      cost_tier: "low",
      asset_ids: [],
      notes: ["Rejected because gameplay readability collapsed.", "Keep arena geography visible."],
    },
  ],
  successful_generations: [
    {
      generation_id: "success-wave-readable-001",
      recorded_at: DEFAULT_CREATED_AT,
      shot_id: "shot-wave-reveal-001",
      status: "successful",
      prompt_summary: "Readable arena reveal with light motion and preserved tactical clarity.",
      engine: "planning-placeholder",
      cost_tier: "low",
      asset_ids: ["prompt-wave-reveal-001"],
      notes: ["Use as the canonical starting point for BABYLON cutscene proofs."],
    },
  ],
  edit_decisions: [
    "Keep cutscene inserts short enough that they can hand control back to gameplay cleanly.",
    "Prefer inserts that clarify upcoming threat state instead of abstract montage."],
  pacing_notes: [
    "Pre-combat beats should feel brief and intentional, not like separate non-interactive scenes.",
    "Use a quick rise in framing intensity just before the player regains control."],
  gameplay_context: {
    current_sequence: "Wave transition pressure beat",
    trigger_conditions: ["wave countdown active", "arena state stable", "player not dead"],
    player_state_requirements: ["player weapon equipped", "camera ownership stable", "HUD readable"],
    blocked_by: ["combat still active", "unresolved validation regressions"],
    downstream_payoffs: ["clearer wave start anticipation", "gameplay-cinematic continuity proof for BABYLON 2026"],
  },
  cost_aware_iteration_notes: [
    "Start with low-cost prompt and storyboard iterations before any expensive video generation pass.",
    "Reuse approved prompts and shot language before introducing new stylistic branches.",
  ],
};

function cloneDefaultRecord(): CinematicProductionMemoryRecord {
  return JSON.parse(JSON.stringify(DEFAULT_PRODUCTION_MEMORY_RECORD)) as CinematicProductionMemoryRecord;
}

function hydrateProductionMemoryRecord(record: Partial<CinematicProductionMemoryRecord> | undefined): CinematicProductionMemoryRecord {
  const defaults = cloneDefaultRecord();
  const nextRecord = record ?? {};

  return {
    ...defaults,
    ...nextRecord,
    roadmap_systems: nextRecord.roadmap_systems ?? defaults.roadmap_systems,
    characters: nextRecord.characters ?? defaults.characters,
    environments: nextRecord.environments ?? defaults.environments,
    story_beats: nextRecord.story_beats ?? defaults.story_beats,
    emotional_tone: nextRecord.emotional_tone ?? defaults.emotional_tone,
    visual_style: nextRecord.visual_style ?? defaults.visual_style,
    camera_language: nextRecord.camera_language ?? defaults.camera_language,
    lighting: nextRecord.lighting ?? defaults.lighting,
    props: nextRecord.props ?? defaults.props,
    continuity_rules: nextRecord.continuity_rules ?? defaults.continuity_rules,
    scene_sequences: nextRecord.scene_sequences ?? defaults.scene_sequences,
    gameplay_cutscene_triggers: nextRecord.gameplay_cutscene_triggers ?? defaults.gameplay_cutscene_triggers,
    shot_history: nextRecord.shot_history ?? defaults.shot_history,
    generated_assets: nextRecord.generated_assets ?? defaults.generated_assets,
    failed_generations: nextRecord.failed_generations ?? defaults.failed_generations,
    successful_generations: nextRecord.successful_generations ?? defaults.successful_generations,
    asset_reuse_decisions: nextRecord.asset_reuse_decisions ?? defaults.asset_reuse_decisions,
    generation_jobs: nextRecord.generation_jobs ?? defaults.generation_jobs,
    generation_job_history: nextRecord.generation_job_history ?? defaults.generation_job_history,
    execution_approval_tokens: nextRecord.execution_approval_tokens ?? defaults.execution_approval_tokens,
    approval_audit_trail: nextRecord.approval_audit_trail ?? defaults.approval_audit_trail,
    budget_governance_decisions: nextRecord.budget_governance_decisions ?? defaults.budget_governance_decisions,
    continuity_review_notes: nextRecord.continuity_review_notes ?? defaults.continuity_review_notes,
    deferred_execution_plans: nextRecord.deferred_execution_plans ?? defaults.deferred_execution_plans,
    provider_capability_registry: nextRecord.provider_capability_registry ?? defaults.provider_capability_registry,
    local_model_registry: nextRecord.local_model_registry ?? defaults.local_model_registry,
    local_model_loader_registry: nextRecord.local_model_loader_registry ?? defaults.local_model_loader_registry,
    local_runtime_capability_registry: nextRecord.local_runtime_capability_registry ?? defaults.local_runtime_capability_registry,
    controlled_runtime_profiles: nextRecord.controlled_runtime_profiles ?? defaults.controlled_runtime_profiles,
    activation_authority_registry: nextRecord.activation_authority_registry ?? defaults.activation_authority_registry,
    execution_temperature_state_history: nextRecord.execution_temperature_state_history ?? defaults.execution_temperature_state_history,
    local_hardware_profiles: nextRecord.local_hardware_profiles ?? defaults.local_hardware_profiles,
    local_runtime_readiness_rules: nextRecord.local_runtime_readiness_rules ?? defaults.local_runtime_readiness_rules,
    local_provider_routing_rules: nextRecord.local_provider_routing_rules ?? defaults.local_provider_routing_rules,
    local_inference_governance_rules: nextRecord.local_inference_governance_rules ?? defaults.local_inference_governance_rules,
    local_asset_cache_strategy: nextRecord.local_asset_cache_strategy ?? defaults.local_asset_cache_strategy,
    local_inference_notes: nextRecord.local_inference_notes ?? defaults.local_inference_notes,
    local_runtime_probe_path_hints: nextRecord.local_runtime_probe_path_hints ?? defaults.local_runtime_probe_path_hints,
    local_runtime_probe_snapshots: nextRecord.local_runtime_probe_snapshots ?? defaults.local_runtime_probe_snapshots,
    frame_generation_stage_registry: nextRecord.frame_generation_stage_registry ?? defaults.frame_generation_stage_registry,
    renderer_capability_roadmap: nextRecord.renderer_capability_roadmap ?? defaults.renderer_capability_roadmap,
    runtime_constraint_models: nextRecord.runtime_constraint_models ?? defaults.runtime_constraint_models,
    hybrid_local_cloud_strategies: nextRecord.hybrid_local_cloud_strategies ?? defaults.hybrid_local_cloud_strategies,
    readiness_delta_tracking_history: nextRecord.readiness_delta_tracking_history ?? defaults.readiness_delta_tracking_history,
    execution_boundary_status_history: nextRecord.execution_boundary_status_history ?? defaults.execution_boundary_status_history,
    pre_inference_gate_validation_history: nextRecord.pre_inference_gate_validation_history ?? defaults.pre_inference_gate_validation_history,
    inference_entry_sequencing_history: nextRecord.inference_entry_sequencing_history ?? defaults.inference_entry_sequencing_history,
    forbidden_execution_state_history: nextRecord.forbidden_execution_state_history ?? defaults.forbidden_execution_state_history,
    governance_escalation_modeling_history: nextRecord.governance_escalation_modeling_history ?? defaults.governance_escalation_modeling_history,
    future_unlock_conditions_history: nextRecord.future_unlock_conditions_history ?? defaults.future_unlock_conditions_history,
    dry_inference_warmup_history: nextRecord.dry_inference_warmup_history ?? defaults.dry_inference_warmup_history,
    single_frame_execution_precursor_history: nextRecord.single_frame_execution_precursor_history ?? defaults.single_frame_execution_precursor_history,
    frame_stage_readiness_history: nextRecord.frame_stage_readiness_history ?? defaults.frame_stage_readiness_history,
    warmup_escalation_modeling_history: nextRecord.warmup_escalation_modeling_history ?? defaults.warmup_escalation_modeling_history,
    future_bounded_execution_rules_history: nextRecord.future_bounded_execution_rules_history ?? defaults.future_bounded_execution_rules_history,
    dry_execution_token_registry_history: nextRecord.dry_execution_token_registry_history ?? defaults.dry_execution_token_registry_history,
    single_frame_dry_execution_path_history: nextRecord.single_frame_dry_execution_path_history ?? defaults.single_frame_dry_execution_path_history,
    frame_traversal_validation_history: nextRecord.frame_traversal_validation_history ?? defaults.frame_traversal_validation_history,
    dry_execution_recovery_history: nextRecord.dry_execution_recovery_history ?? defaults.dry_execution_recovery_history,
    future_frame_synthesis_unlocks_history: nextRecord.future_frame_synthesis_unlocks_history ?? defaults.future_frame_synthesis_unlocks_history,
    execution_attempt_ledger_history: nextRecord.execution_attempt_ledger_history ?? defaults.execution_attempt_ledger_history,
    synthesis_containment_registry_history: nextRecord.synthesis_containment_registry_history ?? defaults.synthesis_containment_registry_history,
    governed_synthesis_preparation_history: nextRecord.governed_synthesis_preparation_history ?? defaults.governed_synthesis_preparation_history,
    synthesis_validation_layer_history: nextRecord.synthesis_validation_layer_history ?? defaults.synthesis_validation_layer_history,
    contained_escalation_modeling_history: nextRecord.contained_escalation_modeling_history ?? defaults.contained_escalation_modeling_history,
    future_low_resolution_output_history: nextRecord.future_low_resolution_output_history ?? defaults.future_low_resolution_output_history,
    governed_rollback_ledger_history: nextRecord.governed_rollback_ledger_history ?? defaults.governed_rollback_ledger_history,
    real_output_authorization_registry_history: nextRecord.real_output_authorization_registry_history ?? defaults.real_output_authorization_registry_history,
    governed_low_resolution_sandbox_history: nextRecord.governed_low_resolution_sandbox_history ?? defaults.governed_low_resolution_sandbox_history,
    first_real_synthesis_path_history: nextRecord.first_real_synthesis_path_history ?? defaults.first_real_synthesis_path_history,
    output_containment_validation_history: nextRecord.output_containment_validation_history ?? defaults.output_containment_validation_history,
    real_output_rollback_history: nextRecord.real_output_rollback_history ?? defaults.real_output_rollback_history,
    future_renderer_escalation_history: nextRecord.future_renderer_escalation_history ?? defaults.future_renderer_escalation_history,
    provider_routing_rules: nextRecord.provider_routing_rules ?? defaults.provider_routing_rules,
    prompt_normalization_rules: nextRecord.prompt_normalization_rules ?? defaults.prompt_normalization_rules,
    provider_validation_rules: nextRecord.provider_validation_rules ?? defaults.provider_validation_rules,
    generation_budget_policy: {
      ...defaults.generation_budget_policy,
      ...(nextRecord.generation_budget_policy ?? {}),
    },
    generation_budget_rules: nextRecord.generation_budget_rules ?? defaults.generation_budget_rules,
    manual_approval_workflow: nextRecord.manual_approval_workflow ?? defaults.manual_approval_workflow,
    execution_lifecycle_rules: nextRecord.execution_lifecycle_rules ?? defaults.execution_lifecycle_rules,
    retry_planning_rules: nextRecord.retry_planning_rules ?? defaults.retry_planning_rules,
    cost_aware_generation_strategy: nextRecord.cost_aware_generation_strategy ?? defaults.cost_aware_generation_strategy,
    cost_forecast_examples: nextRecord.cost_forecast_examples ?? defaults.cost_forecast_examples,
    provider_payload_examples: nextRecord.provider_payload_examples ?? defaults.provider_payload_examples,
    sandbox_simulations: nextRecord.sandbox_simulations ?? defaults.sandbox_simulations,
    edit_decisions: nextRecord.edit_decisions ?? defaults.edit_decisions,
    pacing_notes: nextRecord.pacing_notes ?? defaults.pacing_notes,
    gameplay_context: {
      ...defaults.gameplay_context,
      ...(nextRecord.gameplay_context ?? {}),
    },
    cost_aware_iteration_notes: nextRecord.cost_aware_iteration_notes ?? defaults.cost_aware_iteration_notes,
  };
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
}

async function writeProductionMemoryRecord(filePath: string, record: CinematicProductionMemoryRecord): Promise<CinematicProductionMemoryRecord> {
  const nextRecord: CinematicProductionMemoryRecord = {
    ...record,
    updated_at: new Date().toISOString(),
  };
  await writeFile(filePath, `${JSON.stringify(nextRecord, null, 2)}\n`, "utf8");
  return nextRecord;
}

async function loadProductionMemory(root?: string): Promise<CinematicProductionMemoryInitialization> {
  const repoRoot = await resolveRepoRoot(root ?? process.cwd());
  const productionMemoryPath = path.join(repoRoot, SECOND_BRAIN_DIR, PRODUCTION_MEMORY_FILE);
  await ensureFile(productionMemoryPath, `${JSON.stringify(cloneDefaultRecord(), null, 2)}\n`);

  let record = cloneDefaultRecord();
  try {
    const parsed = JSON.parse(await readFile(productionMemoryPath, "utf8")) as Partial<CinematicProductionMemoryRecord>;
    record = hydrateProductionMemoryRecord(parsed);
  } catch {
    record = cloneDefaultRecord();
  }

  return {
    repoRoot,
    productionMemoryPath,
    record,
  };
}

function loadProductionMemorySync(root?: string): CinematicProductionMemoryInitialization {
  const repoRoot = resolveRepoRootSync(root ?? process.cwd());
  const productionMemoryPath = path.join(repoRoot, SECOND_BRAIN_DIR, PRODUCTION_MEMORY_FILE);

  let record = cloneDefaultRecord();
  if (existsSync(productionMemoryPath)) {
    try {
      record = hydrateProductionMemoryRecord(JSON.parse(readFileSync(productionMemoryPath, "utf8")) as Partial<CinematicProductionMemoryRecord>);
    } catch {
      record = cloneDefaultRecord();
    }
  }

  return {
    repoRoot,
    productionMemoryPath,
    record,
  };
}

export async function ensureCinematicProductionMemoryInitialized(root?: string): Promise<CinematicProductionMemoryInitialization> {
  return loadProductionMemory(root);
}

export async function readCinematicProductionMemory(input?: { root?: string }): Promise<CinematicProductionMemoryRecord> {
  return (await loadProductionMemory(input?.root)).record;
}

export function readCinematicProductionMemorySync(input?: { root?: string }): CinematicProductionMemoryRecord {
  return loadProductionMemorySync(input?.root).record;
}

export async function writeCinematicProductionMemory(input: {
  root?: string;
  value: Partial<CinematicProductionMemoryRecord>;
}): Promise<CinematicProductionMemoryRecord> {
  const initialization = await loadProductionMemory(input.root);
  const nextRecord = hydrateProductionMemoryRecord({
    ...initialization.record,
    ...input.value,
  });
  return writeProductionMemoryRecord(initialization.productionMemoryPath, nextRecord);
}

function cameraBehaviorMatchesLanguage(cameraLanguage: string[], cameraBehavior: string): boolean {
  const languageTokens = new Set(
    cameraLanguage
      .flatMap((entry) => entry.toLowerCase().split(/[^a-z0-9]+/))
      .filter((entry) => entry.length >= 4),
  );
  return cameraBehavior
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((entry) => entry.length >= 4 && languageTokens.has(entry));
}

export async function recordCinematicGenerationOutcome(input: {
  root?: string;
  entry: CinematicGenerationOutcome;
}): Promise<CinematicProductionMemoryRecord> {
  const initialization = await loadProductionMemory(input.root);
  const entry: CinematicGenerationOutcome = {
    ...input.entry,
    prompt_summary: normalizeText(input.entry.prompt_summary),
    engine: normalizeText(input.entry.engine),
    notes: input.entry.notes.map((note) => normalizeText(note)).filter(Boolean),
  };

  const failedGenerations = entry.status === "failed"
    ? [entry, ...initialization.record.failed_generations.filter((value) => value.generation_id !== entry.generation_id)].slice(0, 20)
    : initialization.record.failed_generations;
  const successfulGenerations = entry.status === "successful"
    ? [entry, ...initialization.record.successful_generations.filter((value) => value.generation_id !== entry.generation_id)].slice(0, 20)
    : initialization.record.successful_generations;

  const nextRecord: CinematicProductionMemoryRecord = {
    ...initialization.record,
    failed_generations: failedGenerations,
    successful_generations: successfulGenerations,
  };

  return writeProductionMemoryRecord(initialization.productionMemoryPath, nextRecord);
}

export async function recordCinematicShotHistory(input: {
  root?: string;
  entry: CinematicShotRecord;
}): Promise<CinematicProductionMemoryRecord> {
  const initialization = await loadProductionMemory(input.root);
  const entry: CinematicShotRecord = {
    ...input.entry,
    intent: normalizeText(input.entry.intent),
    camera_framing: normalizeText(input.entry.camera_framing),
    camera_motion: normalizeText(input.entry.camera_motion),
    lens_language: normalizeText(input.entry.lens_language),
    lighting_direction: normalizeText(input.entry.lighting_direction),
    outcome: normalizeText(input.entry.outcome),
  };

  const nextRecord: CinematicProductionMemoryRecord = {
    ...initialization.record,
    shot_history: [entry, ...initialization.record.shot_history.filter((value) => value.shot_id !== entry.shot_id)].slice(0, 40),
  };

  return writeProductionMemoryRecord(initialization.productionMemoryPath, nextRecord);
}

function createDefaultSequenceShots(input: {
  sequenceId: string;
  beat: CinematicStoryBeat;
  characterId: string;
  environmentId: string;
  reusableAssetIds: string[];
}): CinematicSceneSequenceShot[] {
  const shotTemplate: Array<{
    purpose: CinematicShotPurpose;
    emotionalIntent: string;
    cameraBehavior: string;
    transitionNotes: string;
    toneReference: string;
    lightingReference: string;
    propIds: string[];
  }> = [
    {
      purpose: "intro-shot",
      emotionalIntent: "announce the sequence opening with minimal disruption",
      cameraBehavior: "brief transition from gameplay framing into cinematic language",
      transitionNotes: "Open from the current gameplay state without disorientation.",
      toneReference: "pressured",
      lightingReference: "arena practicals over abstract mood lighting",
      propIds: ["arena barriers"],
    },
    {
      purpose: "establish-environment",
      emotionalIntent: "reassert environment geography",
      cameraBehavior: "wide layout-establishing frame",
      transitionNotes: "Make the playable space readable immediately.",
      toneReference: "readable",
      lightingReference: "arena practicals over abstract mood lighting",
      propIds: ["spawn pads", "arena barriers"],
    },
    {
      purpose: "reveal-subject",
      emotionalIntent: "anchor the subject within the environment",
      cameraBehavior: "subject reveal with tactical silhouette emphasis",
      transitionNotes: "Shift from environment to subject without losing geography.",
      toneReference: "confident",
      lightingReference: "rim light for subject separation",
      propIds: ["weapon silhouettes"],
    },
    {
      purpose: "escalation-shot",
      emotionalIntent: "increase threat pressure",
      cameraBehavior: "controlled escalation push-in",
      transitionNotes: "Raise intensity while preserving readable threat lanes.",
      toneReference: "kinetic",
      lightingReference: "arena practicals over abstract mood lighting",
      propIds: ["enemy spawn markers"],
    },
    {
      purpose: "emotional-beat",
      emotionalIntent: input.beat.emotional_goal,
      cameraBehavior: "brief emotional emphasis insert",
      transitionNotes: "Hold only long enough to land the emotional beat.",
      toneReference: "resolve",
      lightingReference: "rim light for subject separation",
      propIds: ["weapon silhouettes"],
    },
    {
      purpose: "transition-shot",
      emotionalIntent: "prepare gameplay re-entry",
      cameraBehavior: "glide back toward gameplay-owned camera position",
      transitionNotes: "Reduce cinematic separation and prepare handoff.",
      toneReference: "readable",
      lightingReference: "arena practicals over abstract mood lighting",
      propIds: ["arena barriers"],
    },
    {
      purpose: "gameplay-return",
      emotionalIntent: "return agency on a clean escalation beat",
      cameraBehavior: "land on gameplay camera continuity",
      transitionNotes: "Return control immediately after the beat resolves.",
      toneReference: "pressured",
      lightingReference: "arena practicals over abstract mood lighting",
      propIds: ["enemy spawn markers", "weapon silhouettes"],
    },
  ];

  return shotTemplate.map((template, index) => ({
    shot_id: `${input.sequenceId}-${template.purpose}`,
    shot_order: index + 1,
    shot_purpose: template.purpose,
    emotional_intent: template.emotionalIntent,
    gameplay_trigger: input.beat.gameplay_trigger,
    continuity_dependencies: input.beat.continuity_dependencies,
    required_assets: input.reusableAssetIds,
    camera_behavior: template.cameraBehavior,
    transition_notes: template.transitionNotes,
    character_ids: [input.characterId],
    environment_id: input.environmentId,
    lighting_reference: template.lightingReference,
    prop_ids: template.propIds,
    tone_reference: template.toneReference,
    timeline_position: index + 1,
  }));
}

export async function planCinematicSequence(input: {
  root?: string;
  sequenceId: string;
  beatId?: string;
  title?: string;
  persist?: boolean;
}): Promise<PlannedSequenceResult> {
  const initialization = await loadProductionMemory(input.root);
  const beat = initialization.record.story_beats.find((entry) => entry.beat_id === (input.beatId ?? initialization.record.story_beats[0]?.beat_id));
  if (!beat) {
    throw new Error("No cinematic story beat available for sequence planning.");
  }

  const primaryCharacter = initialization.record.characters[0];
  const primaryEnvironment = initialization.record.environments[0];
  if (!primaryCharacter || !primaryEnvironment) {
    throw new Error("Cinematic planning requires at least one character and one environment.");
  }

  const reusableAssetIds = initialization.record.generated_assets.filter((entry) => entry.reusable).map((entry) => entry.asset_id).slice(0, 3);
  const sequence: CinematicSceneSequence = {
    sequence_id: input.sequenceId,
    title: input.title ?? `${beat.title} Sequence`,
    beat_id: beat.beat_id,
    shots: createDefaultSequenceShots({
      sequenceId: input.sequenceId,
      beat,
      characterId: primaryCharacter.character_id,
      environmentId: primaryEnvironment.environment_id,
      reusableAssetIds,
    }),
  };

  if (input.persist === false) {
    return { sequence, persisted: false };
  }

  const nextRecord: CinematicProductionMemoryRecord = {
    ...initialization.record,
    scene_sequences: [sequence, ...initialization.record.scene_sequences.filter((entry) => entry.sequence_id !== sequence.sequence_id)].slice(0, 16),
  };
  await writeProductionMemoryRecord(initialization.productionMemoryPath, nextRecord);
  return { sequence, persisted: true };
}

export async function validateCinematicSequenceContinuity(input: {
  root?: string;
  sequenceId: string;
}): Promise<ContinuityValidationResult> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const sequence = record.scene_sequences.find((entry) => entry.sequence_id === input.sequenceId);
  if (!sequence) {
    throw new Error(`Unknown cinematic sequence id: ${input.sequenceId}`);
  }

  const characterIds = new Set(record.characters.map((entry) => entry.character_id));
  const environmentIds = new Set(record.environments.map((entry) => entry.environment_id));
  const availableLighting = new Set(record.lighting);
  const availableProps = new Set([...record.props, ...record.environments.flatMap((entry) => entry.props)]);
  const availableTone = new Set(record.emotional_tone);
  const knownCameraLanguage = record.camera_language.join(" ").toLowerCase();
  const mismatches: ContinuityValidationMismatch[] = [];
  let lastTimelinePosition = 0;

  for (const shot of [...sequence.shots].sort((left, right) => left.shot_order - right.shot_order)) {
    if (!shot.character_ids.every((entry) => characterIds.has(entry))) {
      mismatches.push({ category: "character-continuity", shot_id: shot.shot_id, detail: "Shot references an unknown character profile." });
    }
    if (!environmentIds.has(shot.environment_id)) {
      mismatches.push({ category: "environment-continuity", shot_id: shot.shot_id, detail: "Shot references an unknown environment profile." });
    }
    if (!availableLighting.has(shot.lighting_reference)) {
      mismatches.push({ category: "lighting-continuity", shot_id: shot.shot_id, detail: "Shot lighting reference is outside production memory." });
    }
    if (!shot.prop_ids.every((entry) => availableProps.has(entry))) {
      mismatches.push({ category: "prop-continuity", shot_id: shot.shot_id, detail: "Shot uses props that are not in the bounded production memory." });
    }
    if (!availableTone.has(shot.tone_reference)) {
      mismatches.push({ category: "tone-continuity", shot_id: shot.shot_id, detail: "Shot tone is outside the approved emotional tone set." });
    }
    if (!cameraBehaviorMatchesLanguage(record.camera_language, shot.camera_behavior)) {
      mismatches.push({ category: "camera-continuity", shot_id: shot.shot_id, detail: "Shot camera behavior is not aligned with the stored camera language." });
    }
    if (shot.timeline_position <= lastTimelinePosition || shot.timeline_position !== shot.shot_order) {
      mismatches.push({ category: "timeline-consistency", shot_id: shot.shot_id, detail: "Shot timeline position must increase monotonically and match shot order." });
    }
    lastTimelinePosition = shot.timeline_position;
  }

  return {
    sequence_id: sequence.sequence_id,
    valid: mismatches.length === 0,
    mismatches,
  };
}

function latestGenerationStatus(entries: CinematicGenerationOutcome[], shotId: string): CinematicGenerationOutcome | undefined {
  return entries
    .filter((entry) => entry.shot_id === shotId)
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0];
}

function createGenerationJobHistoryEntry(input: {
  job: CinematicGenerationJob;
  detail: string;
}): CinematicGenerationJobHistoryEntry {
  return {
    event_id: `${input.job.job_id}-${input.job.generation_status}-${input.job.retry_count}-${Date.now()}`,
    job_id: input.job.job_id,
    provider: input.job.provider,
    shot_id: input.job.shot_id,
    generation_status: input.job.generation_status,
    validation_state: input.job.validation_state,
    detail: input.detail,
    recorded_at: new Date().toISOString(),
  };
}

function nextApprovalAuditIndex(record: CinematicProductionMemoryRecord): number {
  return record.approval_audit_trail.length + 1;
}

function buildApprovalAuditEntry(input: {
  record: CinematicProductionMemoryRecord;
  action: CinematicOperatorAction;
  operatorId: string;
  provider: CinematicGenerationProvider;
  sequenceId: string;
  jobIds: string[];
  detail: string;
  approvalTokenId?: string | null;
  budgetOverrideDecisionId?: string | null;
}): CinematicApprovalAuditEntry {
  return {
    audit_id: `approval-audit-${input.provider.toLowerCase()}-${input.sequenceId}-${nextApprovalAuditIndex(input.record)}`,
    append_only_index: nextApprovalAuditIndex(input.record),
    action: input.action,
    operator_id: input.operatorId,
    provider: input.provider,
    sequence_id: input.sequenceId,
    job_ids: input.jobIds,
    detail: input.detail,
    recorded_at: new Date().toISOString(),
    sandbox_only: input.record.generation_budget_policy.sandbox_only_mode,
    approval_token_id: input.approvalTokenId ?? null,
    budget_override_decision_id: input.budgetOverrideDecisionId ?? null,
  };
}

function resolveKnownGenerationJobs(record: CinematicProductionMemoryRecord, jobIds: string[]): CinematicGenerationJob[] {
  const jobs = record.generation_jobs.filter((entry) => jobIds.includes(entry.job_id));
  if (jobs.length !== jobIds.length) {
    throw new Error("Operator action requires known generation jobs.");
  }
  return jobs;
}

function resolveSharedJobContext(jobs: CinematicGenerationJob[]): {
  provider: CinematicGenerationProvider;
  sequenceId: string;
} {
  const provider = jobs[0]?.provider;
  const sequenceId = jobs[0]?.sequence_id;
  if (!provider || !sequenceId) {
    throw new Error("Operator action requires at least one generation job.");
  }
  if (jobs.some((entry) => entry.provider !== provider || entry.sequence_id !== sequenceId)) {
    throw new Error("Operator action requires jobs from one provider and one sequence.");
  }
  return { provider, sequenceId };
}

function withUpdatedJobs(record: CinematicProductionMemoryRecord, jobs: CinematicGenerationJob[]): CinematicProductionMemoryRecord {
  return {
    ...record,
    generation_jobs: upsertGenerationJobs(record.generation_jobs, jobs),
  };
}

function updateJobsForOperatorAction(input: {
  jobs: CinematicGenerationJob[];
  status: CinematicOperatorApprovalStatus;
  approvalTokenId?: string | null;
  deferredUntil?: string | null;
}): CinematicGenerationJob[] {
  const operatorActionAt = new Date().toISOString();
  return input.jobs.map((job) => ({
    ...job,
    manual_approval_status: input.status,
    approval_token_id: input.approvalTokenId ?? job.approval_token_id,
    deferred_until: input.deferredUntil ?? job.deferred_until,
    last_operator_action_at: operatorActionAt,
  }));
}

function resolveApprovalToken(record: CinematicProductionMemoryRecord, tokenId?: string): CinematicExecutionApprovalToken | null {
  if (!tokenId) {
    return null;
  }
  return record.execution_approval_tokens.find((entry) => entry.token_id === tokenId) ?? null;
}

function tokenIsValid(token: CinematicExecutionApprovalToken | null, jobs: CinematicGenerationJob[]): boolean {
  if (!token || !token.active) {
    return false;
  }
  if (new Date(token.expires_at).getTime() <= Date.now()) {
    return false;
  }
  return jobs.every((entry) => token.job_ids.includes(entry.job_id) && token.provider === entry.provider && token.sequence_id === entry.sequence_id);
}

function upsertGenerationJobs(currentJobs: CinematicGenerationJob[], nextJobs: CinematicGenerationJob[]): CinematicGenerationJob[] {
  const byId = new Map(currentJobs.map((entry) => [entry.job_id, entry]));
  for (const job of nextJobs) {
    byId.set(job.job_id, job);
  }
  return [...byId.values()].sort((left, right) => left.created_at.localeCompare(right.created_at));
}

function trimPromptToMaxCharacters(prompt: string, maxCharacters: number): CinematicPromptNormalizationResult {
  const normalizedPrompt = normalizeText(prompt).replace(/\s*\|\s*/g, " | ");
  if (normalizedPrompt.length <= maxCharacters) {
    return {
      provider: "LocalFutureProvider",
      normalized_prompt: normalizedPrompt,
      trimmed: false,
      token_budget_hint: Math.ceil(normalizedPrompt.length / 4),
    };
  }

  const trimmedPrompt = `${normalizedPrompt.slice(0, Math.max(0, maxCharacters - 3)).trim()}...`;
  return {
    provider: "LocalFutureProvider",
    normalized_prompt: trimmedPrompt,
    trimmed: true,
    token_budget_hint: Math.ceil(trimmedPrompt.length / 4),
  };
}

function getEstimatedProviderCost(capability: CinematicProviderCapability, costTier: CostTier): number {
  switch (costTier) {
    case "high":
      return capability.estimated_cost_profile.premium;
    case "medium":
      return capability.estimated_cost_profile.standard;
    case "low":
      return capability.estimated_cost_profile.draft;
  }
}

function getRoutingModeCostTier(routingMode: CinematicProviderRoutingMode): CostTier {
  switch (routingMode) {
    case "premium-cinematic-provider":
      return "high";
    case "balanced-comparison-mode":
    case "future-local-inference-mode":
      return "medium";
    case "cheap-draft-provider":
    case "offline-planning-mode":
      return "low";
  }
}

function videoResolutionRank(resolution: CinematicVideoResolution): number {
  switch (resolution) {
    case "720p":
      return 1;
    case "1080p":
      return 2;
    case "1440p":
      return 3;
    case "4k":
      return 4;
  }
}

function localModelStatusWeight(status: CinematicLocalVideoModelStatus): number {
  switch (status) {
    case "validated":
      return 3;
    case "download-planned":
      return 2;
    case "candidate":
      return 1;
  }
}

function localRuntimeStatusWeight(status: CinematicLocalRuntimeStatus): number {
  switch (status) {
    case "detected":
      return 3;
    case "configured":
      return 2;
    case "candidate":
      return 1;
  }
}

function localHardwareStatusWeight(status: CinematicLocalHardwareProfileStatus): number {
  switch (status) {
    case "validated":
      return 3;
    case "profiled":
      return 2;
    case "planned":
      return 1;
  }
}

function frameStageStatusScore(status: CinematicFrameGenerationStageStatus): number {
  switch (status) {
    case "foundation":
      return 0.65;
    case "modeled":
      return 0.8;
    case "planned":
      return 0.35;
  }
}

function rendererCapabilityStatusScore(status: CinematicRendererCapabilityStatus): number {
  switch (status) {
    case "foundation":
      return 0.65;
    case "modeled":
      return 0.8;
    case "planned":
      return 0.35;
  }
}

function hybridStrategyStatusScore(status: CinematicHybridStrategyStatus): number {
  switch (status) {
    case "foundation":
      return 0.65;
    case "modeled":
      return 0.8;
    case "planned":
      return 0.35;
  }
}

function uniqueNormalizedStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((entry) => normalizeText(entry)).filter((entry) => entry.length > 0))];
}

function resolveCandidatePaths(root: string, candidates: string[]): string[] {
  return uniqueNormalizedStrings(candidates).map((entry) => path.normalize(path.isAbsolute(entry) ? entry : path.join(root, entry)));
}

function existingPathsFromCandidates(root: string, candidates: string[]): string[] {
  return resolveCandidatePaths(root, candidates).filter((entry) => existsSync(entry));
}

function findExecutablesInPath(names: string[]): string[] {
  const directories = uniqueNormalizedStrings((process.env.PATH ?? "").split(path.delimiter));
  const found: string[] = [];
  for (const directory of directories) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (existsSync(candidate)) {
        found.push(path.normalize(candidate));
      }
    }
  }
  return uniqueNormalizedStrings(found);
}

function latestLocalRuntimeProbeSnapshot(record: CinematicProductionMemoryRecord): CinematicRuntimeProbeSnapshot | null {
  return [...record.local_runtime_probe_snapshots].sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null;
}

function runtimeProbeResult(snapshot: CinematicRuntimeProbeSnapshot | null, probeId: CinematicRuntimeProbeId): CinematicRuntimeProbeResult | null {
  return snapshot?.results.find((entry) => entry.probe_id === probeId) ?? null;
}

function runtimeProbeDetected(snapshot: CinematicRuntimeProbeSnapshot | null, probeId: CinematicRuntimeProbeId): boolean {
  const result = runtimeProbeResult(snapshot, probeId);
  return result?.status === "detected" || result?.status === "derived";
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function percentageFromChecks(checks: Array<{ passed: boolean; weight: number }>): number {
  const totalWeight = checks.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return 0;
  }
  const earned = checks.reduce((sum, entry) => sum + (entry.passed ? entry.weight : 0), 0);
  return clampPercentage((earned / totalWeight) * 100);
}

function averageScore(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, entry) => sum + entry, 0) / values.length;
}

function readinessConfidenceFromPercentage(percentage: number, evidenceCount: number): CinematicReadinessConfidence {
  if (percentage >= 70 && evidenceCount >= 5) {
    return "high";
  }
  if (percentage >= 35 && evidenceCount >= 2) {
    return "medium";
  }
  return "low";
}

function buildRuntimeProbeAdapters(): CinematicRuntimeProbeAdapter[] {
  return [
    {
      probe_id: "cuda-installation",
      summary: "Detect CUDA installation roots through read-only filesystem and environment inspection.",
      read_only: true,
      signals: ["CUDA_PATH", "configured paths", "standard install directories"],
    },
    {
      probe_id: "gpu-vendor-visibility",
      summary: "Infer visible GPU vendor hints without launching any hardware query tools.",
      read_only: true,
      signals: ["environment hints", "hardware profiles", "configured backend families"],
    },
    {
      probe_id: "vram-reporting-capability",
      summary: "Check whether bounded VRAM reporting inputs are available from stored hardware profiles.",
      read_only: true,
      signals: ["hardware profiles", "probe hints"],
    },
    {
      probe_id: "ffmpeg-availability",
      summary: "Detect FFmpeg binaries via configured paths and PATH scanning only.",
      read_only: true,
      signals: ["configured ffmpeg paths", "PATH executable scan"],
    },
    {
      probe_id: "python-runtime-presence",
      summary: "Detect Python runtimes through configured paths, PATH scanning, and repo-local virtual environments.",
      read_only: true,
      signals: ["configured python paths", "PATH executable scan", ".venv"],
    },
    {
      probe_id: "inference-runtime-presence",
      summary: "Detect installed inference runtime folders without importing or launching them.",
      read_only: true,
      signals: ["ComfyUI folders", "diffusers package path", "torch package path"],
    },
    {
      probe_id: "local-model-directory-presence",
      summary: "Detect local model directories using configured bounded path hints.",
      read_only: true,
      signals: ["configured model directories", "repo-local model roots"],
    },
    {
      probe_id: "storage-space-estimate",
      summary: "Use bounded stored hardware estimates rather than live disk queries.",
      read_only: true,
      signals: ["hardware profile storage estimates", "manual estimate hint"],
    },
  ];
}

function resolveGpuVendor(input: {
  hardwareProfiles: CinematicLocalHardwareProfile[];
  gpuVendorHint?: string;
}): string | null {
  const vendorHint = normalizeText(input.gpuVendorHint).toLowerCase();
  if (vendorHint.length > 0) {
    return vendorHint;
  }
  if (process.env.CUDA_PATH || input.hardwareProfiles.some((entry) => entry.accelerator_backend === "cuda")) {
    return "nvidia";
  }
  if (process.env.HIP_PATH || input.hardwareProfiles.some((entry) => entry.accelerator_backend === "rocm")) {
    return "amd";
  }
  if (process.env.ONEAPI_ROOT) {
    return "intel";
  }
  if (input.hardwareProfiles.some((entry) => entry.accelerator_backend === "directml")) {
    return "windows-gpu-visible";
  }
  return null;
}

function buildReadinessMilestoneProgress(input: {
  record: CinematicProductionMemoryRecord;
  snapshot: CinematicRuntimeProbeSnapshot | null;
  preferredModel: CinematicLocalVideoModelProfile | null;
  preferredRuntime: CinematicLocalRuntimeCapability | null;
  preferredHardware: CinematicLocalHardwareProfile | null;
  localProviderAvailable: boolean;
}): CinematicReadinessMilestoneProgress[] {
  const frameStageAverage = averageScore(input.record.frame_generation_stage_registry.map((entry) => frameStageStatusScore(entry.status)));
  const rendererAverage = averageScore(input.record.renderer_capability_roadmap.map((entry) => rendererCapabilityStatusScore(entry.status)));
  const hybridAverage = averageScore(input.record.hybrid_local_cloud_strategies.map((entry) => hybridStrategyStatusScore(entry.status)));
  const continuityStrength = input.preferredModel ? localContinuityWeight(input.preferredModel.continuity_support) / 3 : 0;
  const activationSimulationPresent = input.record.sandbox_simulations.some(
    (entry) => entry.sandbox_kind === "local-model-loader-runtime-activation-simulation",
  );
  const bootstrapSimulationPresent = input.record.sandbox_simulations.some(
    (entry) => entry.sandbox_kind === "controlled-local-inference-bootstrap",
  );
  const dryInitializedBootstrap = input.record.sandbox_simulations.some(
    (entry) => entry.execution_boundary_status?.current_status === "dry_initialized",
  );
  const activationReadyLoaders = input.record.local_model_loader_registry.filter((entry) => entry.status === "activation-ready").length;
  const registeredLoaders = input.record.local_model_loader_registry.length;
  const readinessChecks = {
    python: runtimeProbeDetected(input.snapshot, "python-runtime-presence"),
    ffmpeg: runtimeProbeDetected(input.snapshot, "ffmpeg-availability"),
    inference: runtimeProbeDetected(input.snapshot, "inference-runtime-presence"),
    models: runtimeProbeDetected(input.snapshot, "local-model-directory-presence"),
    storage: runtimeProbeDetected(input.snapshot, "storage-space-estimate"),
    cuda: runtimeProbeDetected(input.snapshot, "cuda-installation"),
    gpuVendor: runtimeProbeDetected(input.snapshot, "gpu-vendor-visibility"),
    vram: runtimeProbeDetected(input.snapshot, "vram-reporting-capability"),
  };
  const localInferencePercentage = percentageFromChecks([
    { passed: input.record.local_model_registry.length > 0, weight: 15 },
    { passed: registeredLoaders > 0, weight: 10 },
    { passed: activationReadyLoaders > 0, weight: 10 },
    { passed: input.record.local_runtime_capability_registry.length > 0, weight: 10 },
    { passed: input.record.local_hardware_profiles.length > 0, weight: 10 },
    { passed: input.snapshot !== null, weight: 10 },
    { passed: readinessChecks.python, weight: 10 },
    { passed: readinessChecks.inference, weight: 10 },
    { passed: readinessChecks.models, weight: 10 },
    { passed: input.record.local_provider_routing_rules.length > 0, weight: 10 },
    { passed: input.record.local_asset_cache_strategy.length > 0, weight: 5 },
    { passed: input.record.local_inference_governance_rules.length > 0, weight: 5 },
    { passed: input.record.frame_generation_stage_registry.length > 0, weight: 5 },
    { passed: activationSimulationPresent, weight: 8 },
    { passed: bootstrapSimulationPresent, weight: 8 },
    { passed: dryInitializedBootstrap, weight: 4 },
  ]);
  const localRuntimePercentage = percentageFromChecks([
    { passed: input.snapshot !== null, weight: 15 },
    { passed: registeredLoaders > 0, weight: 10 },
    { passed: readinessChecks.cuda, weight: 12 },
    { passed: readinessChecks.gpuVendor, weight: 10 },
    { passed: readinessChecks.vram, weight: 10 },
    { passed: readinessChecks.ffmpeg, weight: 10 },
    { passed: readinessChecks.python, weight: 15 },
    { passed: readinessChecks.inference, weight: 15 },
    { passed: readinessChecks.models, weight: 8 },
    { passed: readinessChecks.storage, weight: 5 },
    { passed: activationSimulationPresent, weight: 8 },
    { passed: bootstrapSimulationPresent, weight: 8 },
    { passed: dryInitializedBootstrap, weight: 6 },
  ]);
  const frameGenerationPercentage = clampPercentage((frameStageAverage * 75)
    + (input.record.local_model_registry.length > 0 ? 10 : 0)
    + (input.record.runtime_constraint_models.length > 0 ? 8 : 0)
    + (input.snapshot ? 7 : 0)
    + (registeredLoaders > 0 ? 5 : 0)
    + (bootstrapSimulationPresent ? 6 : 0));
  const rendererPercentage = clampPercentage((rendererAverage * 75)
    + (readinessChecks.ffmpeg ? 10 : 0)
    + (readinessChecks.storage ? 8 : 0)
    + (input.record.frame_generation_stage_registry.some((entry) => entry.stage_id === "render-packaging" && entry.status !== "planned") ? 7 : 0)
    + (activationSimulationPresent ? 5 : 0)
    + (bootstrapSimulationPresent ? 6 : 0));
  const continuityPercentage = clampPercentage((continuityStrength * 35)
    + (input.record.frame_generation_stage_registry.some((entry) => entry.stage_id === "temporal-continuity" && entry.status !== "planned") ? 20 : 0)
    + (input.record.renderer_capability_roadmap.some((entry) => entry.capability_id === "continuity-state-reuse" && entry.status !== "planned") ? 15 : 0)
    + (input.record.continuity_rules.length > 0 ? 15 : 0)
    + (input.localProviderAvailable ? 15 : 0)
    + (activationReadyLoaders > 0 ? 10 : 0)
    + (bootstrapSimulationPresent ? 5 : 0));
  const hybridPercentage = clampPercentage((hybridAverage * 70)
    + (input.record.provider_routing_rules.length > 0 ? 10 : 0)
    + (input.record.runtime_constraint_models.length > 0 ? 10 : 0)
    + (input.record.local_provider_routing_rules.length > 0 ? 10 : 0)
    + (activationSimulationPresent ? 5 : 0)
    + (bootstrapSimulationPresent ? 5 : 0));
  const selfSustainingPercentage = percentageFromChecks([
    { passed: input.record.frame_generation_stage_registry.some((entry) => entry.stage_id === "output-archival" && entry.status !== "planned"), weight: 20 },
    { passed: input.record.local_inference_governance_rules.length > 0, weight: 10 },
    { passed: input.record.approval_audit_trail.length >= 0, weight: 10 },
    { passed: activationSimulationPresent, weight: 10 },
    { passed: bootstrapSimulationPresent, weight: 10 },
    { passed: false, weight: 60 },
  ]);
  return [
    {
      milestone: "local-inference-readiness",
      percentage: localInferencePercentage,
      confidence: readinessConfidenceFromPercentage(localInferencePercentage, 6 + (input.snapshot ? 2 : 0)),
      blockers: [
        ...(input.snapshot ? [] : ["No runtime probe snapshot has been recorded yet."]),
        ...(readinessChecks.inference ? [] : ["Inference runtime presence has not been detected read-only."]),
        ...(readinessChecks.models ? [] : ["Local model directories have not been detected read-only."]),
      ],
      next_required_milestone: "Record a normalized runtime probe snapshot and bind it into readiness review.",
      estimated_architectural_dependency: "runtime probe normalization -> local readiness gate -> manual local bridge preview",
      missing_dependencies: [
        ...(readinessChecks.python ? [] : ["python runtime detection"]),
        ...(readinessChecks.inference ? [] : ["inference runtime detection"]),
        ...(readinessChecks.models ? [] : ["local model directory detection"]),
        ...(registeredLoaders > 0 ? [] : ["model loader registry"]),
        ...(activationReadyLoaders > 0 ? [] : ["activation-ready loader"]),
        ...(dryInitializedBootstrap ? [] : ["dry runtime bootstrap evidence"]),
      ],
    },
    {
      milestone: "local-runtime-readiness",
      percentage: localRuntimePercentage,
      confidence: readinessConfidenceFromPercentage(localRuntimePercentage, input.snapshot ? 6 : 1),
      blockers: [
        ...(readinessChecks.cuda ? [] : ["CUDA installation is not detected read-only."]),
        ...(readinessChecks.gpuVendor ? [] : ["GPU vendor visibility is not confirmed."]),
        ...(readinessChecks.ffmpeg ? [] : ["FFmpeg is not detected in configured paths or PATH."]),
        ...(readinessChecks.inference ? [] : ["Inference runtime folders are not detected."]),
      ],
      next_required_milestone: "Promote configured path hints into verified runtime probe evidence.",
      estimated_architectural_dependency: "path hints -> runtime probe snapshot -> constraint modeling",
      missing_dependencies: [
        ...(readinessChecks.vram ? [] : ["VRAM reporting evidence"]),
        ...(readinessChecks.storage ? [] : ["storage estimate evidence"]),
        ...(activationSimulationPresent ? [] : ["runtime activation simulation evidence"]),
        ...(bootstrapSimulationPresent ? [] : ["controlled bootstrap evidence"]),
      ],
    },
    {
      milestone: "local-frame-generation-readiness",
      percentage: frameGenerationPercentage,
      confidence: readinessConfidenceFromPercentage(frameGenerationPercentage, input.record.frame_generation_stage_registry.length),
      blockers: input.record.frame_generation_stage_registry
        .filter((entry) => entry.status === "planned")
        .map((entry) => `${entry.display_name} remains planning-only.`),
      next_required_milestone: "Convert latent preparation and render packaging into verified non-executing precursor contracts.",
      estimated_architectural_dependency: "frame stage registry -> runtime constraints -> manual-only frame bridge",
      missing_dependencies: [
        ...(input.record.frame_generation_stage_registry.some((entry) => entry.stage_id === "frame-synthesis" && entry.status !== "planned") ? [] : ["frame synthesis contract"]),
        ...(input.record.frame_generation_stage_registry.some((entry) => entry.stage_id === "frame-interpolation" && entry.status !== "planned") ? [] : ["frame interpolation contract"]),
      ],
    },
    {
      milestone: "local-renderer-readiness",
      percentage: rendererPercentage,
      confidence: readinessConfidenceFromPercentage(rendererPercentage, input.record.renderer_capability_roadmap.length),
      blockers: [
        ...(readinessChecks.ffmpeg ? [] : ["FFmpeg packaging support is not yet detected."]),
        ...input.record.renderer_capability_roadmap.filter((entry) => entry.status === "planned").map((entry) => `${entry.display_name} is not scaffolded beyond planning.`),
      ],
      next_required_milestone: "Bind renderer roadmap entries to verified probe evidence and packaging manifests.",
      estimated_architectural_dependency: "renderer roadmap -> ffmpeg evidence -> offline packaging manifest",
      missing_dependencies: [
        ...(input.record.renderer_capability_roadmap.some((entry) => entry.capability_id === "image-sequence-rendering" && entry.status !== "planned") ? [] : ["image sequence rendering scaffold"]),
        ...(input.record.renderer_capability_roadmap.some((entry) => entry.capability_id === "local-upscaling" && entry.status !== "planned") ? [] : ["local upscaling scaffold"]),
      ],
    },
    {
      milestone: "continuity-preserving-local-generation",
      percentage: continuityPercentage,
      confidence: readinessConfidenceFromPercentage(continuityPercentage, 4 + (input.preferredModel ? 1 : 0)),
      blockers: [
        ...(input.preferredModel && localContinuityWeight(input.preferredModel.continuity_support) >= 2 ? [] : ["Preferred local model continuity support is still limited."]),
        ...(input.record.frame_generation_stage_registry.some((entry) => entry.stage_id === "temporal-continuity" && entry.status !== "planned") ? [] : ["Temporal continuity stage is not yet scaffolded strongly enough."]),
      ],
      next_required_milestone: "Strengthen temporal continuity and continuity-state reuse contracts before any local sequence generation bridge.",
      estimated_architectural_dependency: "continuity rules -> temporal stage registry -> continuity-state reuse roadmap",
      missing_dependencies: [
        ...(input.record.renderer_capability_roadmap.some((entry) => entry.capability_id === "continuity-state-reuse" && entry.status !== "planned") ? [] : ["continuity-state reuse scaffold"]),
      ],
    },
    {
      milestone: "hybrid-local-cloud-orchestration",
      percentage: hybridPercentage,
      confidence: readinessConfidenceFromPercentage(hybridPercentage, input.record.hybrid_local_cloud_strategies.length),
      blockers: [
        ...(input.record.hybrid_local_cloud_strategies.some((entry) => entry.strategy_id === "hardware-aware-escalation" && entry.status !== "planned") ? [] : ["Hardware-aware escalation remains planning-only."]),
        ...(input.record.runtime_constraint_models.length > 0 ? [] : ["Runtime constraint modeling is missing."]),
      ],
      next_required_milestone: "Bind hybrid strategy decisions to concrete probe and constraint evidence.",
      estimated_architectural_dependency: "runtime probes -> constraints -> hybrid routing plans -> governed escalation",
      missing_dependencies: [
        ...(input.localProviderAvailable ? [] : ["verified local provider evidence"]),
      ],
    },
    {
      milestone: "self-sustaining-generation-readiness",
      percentage: selfSustainingPercentage,
      confidence: "low",
      blockers: [
        "Autonomous local execution remains intentionally disabled.",
        "Manual approval and sandbox governance still block unattended inference.",
        "No self-sustaining render loop is permitted in this architecture.",
      ],
      next_required_milestone: "Do not pursue this milestone until governance policy explicitly changes.",
      estimated_architectural_dependency: "manual-only local bridge -> reviewed execution receipts -> separate policy approval",
      missing_dependencies: [
        "policy approval for autonomy",
        "reviewed execution bridge",
        "governed recovery loop",
      ],
    },
  ].map((entry) => ({
    ...entry,
    blockers: uniqueNormalizedStrings(entry.blockers),
    missing_dependencies: uniqueNormalizedStrings(entry.missing_dependencies),
  }));
}

function selectHybridStrategyIds(input: {
  record: CinematicProductionMemoryRecord;
  readiness: CinematicLocalInferenceReadinessReport;
  continuityPriority: "low" | "medium" | "high";
  desiredDurationSeconds: number;
  offline: boolean;
}): CinematicHybridStrategyId[] {
  const strategyIds: CinematicHybridStrategyId[] = [];
  if (input.offline) {
    strategyIds.push("offline-safe-mode");
  }
  if (input.readiness.local_provider_available) {
    strategyIds.push("local-draft-rendering");
  } else {
    strategyIds.push("hardware-aware-escalation");
  }
  if (input.continuityPriority === "high") {
    strategyIds.push("continuity-first-routing", "cloud-premium-rendering");
  }
  if (input.desiredDurationSeconds <= 8) {
    strategyIds.push("budget-first-routing");
  }
  if (!input.readiness.local_provider_available && !input.offline && input.continuityPriority !== "high") {
    strategyIds.push("cloud-premium-rendering");
  }
  const allowed = new Set(input.record.hybrid_local_cloud_strategies.map((entry) => entry.strategy_id));
  return [...new Set(strategyIds)].filter((entry) => allowed.has(entry));
}

function localContinuityWeight(support: CinematicLocalVideoModelProfile["continuity_support"]): number {
  switch (support) {
    case "full":
      return 3;
    case "partial":
      return 2;
    case "limited":
      return 1;
  }
}

function supportsRequestedVideoProfile(input: {
  model: CinematicLocalVideoModelProfile;
  hardware: CinematicLocalHardwareProfile;
  desiredResolution: CinematicVideoResolution;
  desiredDurationSeconds: number;
}): boolean {
  return input.model.supported_resolutions.includes(input.desiredResolution)
    && input.model.max_duration_seconds >= input.desiredDurationSeconds
    && videoResolutionRank(input.hardware.recommended_max_resolution) >= videoResolutionRank(input.desiredResolution)
    && input.hardware.recommended_max_duration_seconds >= input.desiredDurationSeconds;
}

function resolvePreferredLocalModel(input: {
  record: CinematicProductionMemoryRecord;
  desiredResolution: CinematicVideoResolution;
  desiredDurationSeconds: number;
  continuityPriority: "low" | "medium" | "high";
}): CinematicLocalVideoModelProfile | null {
  const ranked = input.record.local_model_registry
    .filter((entry) => entry.supported_resolutions.includes(input.desiredResolution) && entry.max_duration_seconds >= input.desiredDurationSeconds)
    .filter((entry) => input.continuityPriority !== "high" || localContinuityWeight(entry.continuity_support) >= 2)
    .sort((left, right) => {
      const weightDelta = localModelStatusWeight(right.status) - localModelStatusWeight(left.status);
      if (weightDelta !== 0) {
        return weightDelta;
      }
      const continuityDelta = localContinuityWeight(right.continuity_support) - localContinuityWeight(left.continuity_support);
      if (continuityDelta !== 0) {
        return continuityDelta;
      }
      return left.vram_requirement_gb - right.vram_requirement_gb;
    });
  return ranked[0] ?? null;
}

function resolvePreferredLocalHardware(input: {
  record: CinematicProductionMemoryRecord;
  model: CinematicLocalVideoModelProfile | null;
  desiredResolution: CinematicVideoResolution;
  desiredDurationSeconds: number;
}): CinematicLocalHardwareProfile | null {
  const ranked = input.record.local_hardware_profiles
    .filter((entry) => !input.model || supportsRequestedVideoProfile({
      model: input.model,
      hardware: entry,
      desiredResolution: input.desiredResolution,
      desiredDurationSeconds: input.desiredDurationSeconds,
    }))
    .sort((left, right) => {
      const weightDelta = localHardwareStatusWeight(right.status) - localHardwareStatusWeight(left.status);
      if (weightDelta !== 0) {
        return weightDelta;
      }
      return right.gpu_vram_gb - left.gpu_vram_gb;
    });
  return ranked[0] ?? null;
}

function resolvePreferredLocalRuntime(input: {
  record: CinematicProductionMemoryRecord;
  hardware: CinematicLocalHardwareProfile | null;
}): CinematicLocalRuntimeCapability | null {
  const ranked = input.record.local_runtime_capability_registry
    .filter((entry) => !input.hardware || entry.supported_backends.includes(input.hardware.accelerator_backend))
    .sort((left, right) => localRuntimeStatusWeight(right.status) - localRuntimeStatusWeight(left.status));
  return ranked[0] ?? null;
}

function summarizeLocalReadiness(input: {
  record: CinematicProductionMemoryRecord;
  desiredResolution: CinematicVideoResolution;
  desiredDurationSeconds: number;
  continuityPriority: "low" | "medium" | "high";
}): CinematicLocalInferenceReadinessReport {
  const preferredModel = resolvePreferredLocalModel(input);
  const preferredHardware = resolvePreferredLocalHardware({
    record: input.record,
    model: preferredModel,
    desiredResolution: input.desiredResolution,
    desiredDurationSeconds: input.desiredDurationSeconds,
  });
  const preferredRuntime = resolvePreferredLocalRuntime({
    record: input.record,
    hardware: preferredHardware,
  });
  const probeSnapshot = latestLocalRuntimeProbeSnapshot(input.record);
  const pythonDetected = runtimeProbeDetected(probeSnapshot, "python-runtime-presence");
  const inferenceRuntimeDetected = runtimeProbeDetected(probeSnapshot, "inference-runtime-presence");
  const localModelDirectoryDetected = runtimeProbeDetected(probeSnapshot, "local-model-directory-presence");
  const ffmpegDetected = runtimeProbeDetected(probeSnapshot, "ffmpeg-availability");
  const checks: CinematicLocalReadinessCheck[] = [
    {
      check: "model-registry-populated",
      passed: input.record.local_model_registry.length > 0 && input.record.local_model_loader_registry.length > 0,
      detail: input.record.local_model_registry.length > 0 && input.record.local_model_loader_registry.length > 0
        ? `${input.record.local_model_registry.length} local model candidates and ${input.record.local_model_loader_registry.length} loader mappings are registered.`
        : "No local video model candidates are registered.",
    },
    {
      check: "runtime-detection-configured",
      passed: input.record.local_runtime_capability_registry.some((entry) => entry.status === "configured" || entry.status === "detected"),
      detail: input.record.local_runtime_capability_registry.some((entry) => entry.status === "configured" || entry.status === "detected")
        ? "At least one local runtime is configured for future detection review."
        : "No local runtime is configured or detected yet.",
    },
    {
      check: "hardware-profile-recorded",
      passed: input.record.local_hardware_profiles.some((entry) => entry.status === "profiled" || entry.status === "validated"),
      detail: input.record.local_hardware_profiles.some((entry) => entry.status === "profiled" || entry.status === "validated")
        ? "At least one local hardware profile has been recorded."
        : "No profiled local hardware target is recorded yet.",
    },
    {
      check: "runtime-probe-recorded",
      passed: probeSnapshot !== null,
      detail: probeSnapshot
        ? `Runtime probe snapshot ${probeSnapshot.snapshot_id} was recorded at ${probeSnapshot.recorded_at}.`
        : "No runtime probe snapshot has been recorded yet.",
    },
    {
      check: "python-runtime-detected",
      passed: pythonDetected,
      detail: pythonDetected
        ? "A Python runtime is visible through bounded read-only inspection."
        : "Python runtime presence is not yet confirmed by a runtime probe snapshot.",
    },
    {
      check: "inference-runtime-detected",
      passed: inferenceRuntimeDetected,
      detail: inferenceRuntimeDetected
        ? "At least one inference runtime path is visible through bounded read-only inspection."
        : "No inference runtime path is confirmed by the current runtime probe snapshot.",
    },
    {
      check: "local-model-path-detected",
      passed: localModelDirectoryDetected,
      detail: localModelDirectoryDetected
        ? "A local model directory is visible through bounded read-only inspection."
        : "No local model directory is confirmed by the current runtime probe snapshot.",
    },
    {
      check: "routing-rules-defined",
      passed: input.record.local_provider_routing_rules.length > 0,
      detail: input.record.local_provider_routing_rules.length > 0
        ? "Local-vs-cloud routing rules are defined."
        : "Local-vs-cloud routing rules are missing.",
    },
    {
      check: "governance-guardrails-preserved",
      passed: input.record.local_inference_governance_rules.some((entry) => /manual-only|non-autonomous/i.test(entry))
        && input.record.generation_budget_policy.manual_approval_required,
      detail: input.record.generation_budget_policy.manual_approval_required
        ? "Manual governance remains preserved for future local inference planning."
        : "Manual approval guardrails are not present.",
    },
    {
      check: "cache-strategy-defined",
      passed: input.record.local_asset_cache_strategy.length > 0,
      detail: input.record.local_asset_cache_strategy.length > 0
        ? "Local asset cache strategy is defined."
        : "Local asset cache strategy is missing.",
    },
  ];
  const candidateSupport = Boolean(preferredModel && preferredHardware && preferredRuntime);
  const preferredLoader = input.record.local_model_loader_registry.find(
    (entry) => entry.model_name === preferredModel?.display_name && entry.runtime_target === preferredRuntime?.runtime_id,
  ) ?? null;
  const localProviderAvailable = candidateSupport
    && preferredLoader !== null
    && preferredLoader.status !== "blocked"
    && localRuntimeStatusWeight(preferredRuntime.status) >= 2
    && localHardwareStatusWeight(preferredHardware.status) >= 2
    && preferredHardware.gpu_vram_gb >= preferredModel.vram_requirement_gb
    && preferredHardware.storage_free_gb >= preferredModel.storage_requirement_gb
    && pythonDetected
    && inferenceRuntimeDetected
    && localModelDirectoryDetected;
  const milestoneProgress = buildReadinessMilestoneProgress({
    record: input.record,
    snapshot: probeSnapshot,
    preferredModel,
    preferredRuntime,
    preferredHardware,
    localProviderAvailable,
  });
  const blockedReasons = [
    ...checks.filter((entry) => !entry.passed).map((entry) => entry.detail),
    ...(preferredModel ? [] : [`No local model currently satisfies ${input.desiredResolution} at ${input.desiredDurationSeconds}s.`]),
    ...(preferredRuntime ? [] : ["No local runtime matches the preferred hardware backend."]),
    ...(preferredHardware ? [] : ["No local hardware profile can satisfy the requested video profile."]),
    ...(ffmpegDetected ? [] : ["FFmpeg has not been detected yet, so future renderer packaging remains incomplete."]),
    ...(localProviderAvailable ? [] : ["Preferred local model/runtime/hardware tuple is not yet ready for a manual bridge review."]),
    ...(input.record.generation_budget_policy.sandbox_only_mode ? ["Sandbox-only mode still blocks any future local execution handoff."] : []),
  ];
  return {
    foundation_ready: checks.every((entry) => entry.passed),
    local_provider_available: localProviderAvailable,
    ready_for_manual_local_execution: localProviderAvailable && !input.record.generation_budget_policy.sandbox_only_mode,
    preferred_model_id: preferredModel?.model_id ?? null,
    preferred_runtime_id: preferredRuntime?.runtime_id ?? null,
    preferred_hardware_profile_id: preferredHardware?.profile_id ?? null,
    recommended_routing_mode: localProviderAvailable ? "future-local-inference-mode" : "offline-planning-mode",
    probe_snapshot: probeSnapshot,
    checks,
    blocked_reasons: blockedReasons,
    planning_notes: input.record.local_inference_notes,
    milestone_progress: milestoneProgress,
  };
}

function buildLocalModelLoaderRegistry(input: {
  record: CinematicProductionMemoryRecord;
  desiredResolution: CinematicVideoResolution;
  desiredDurationSeconds: number;
  continuityPriority: "low" | "medium" | "high";
}): CinematicLocalModelLoaderRecord[] {
  const preferredHardware = resolvePreferredLocalHardware({
    record: input.record,
    model: null,
    desiredResolution: input.desiredResolution,
    desiredDurationSeconds: input.desiredDurationSeconds,
  });
  const preferredRuntime = resolvePreferredLocalRuntime({
    record: input.record,
    hardware: preferredHardware,
  });
  return input.record.local_model_loader_registry.map((loader) => {
    const matchingModel = input.record.local_model_registry.find((entry) => entry.display_name === loader.model_name) ?? null;
    const matchingRuntime = input.record.local_runtime_capability_registry.find((entry) => entry.runtime_id === loader.runtime_target) ?? null;
    const missingDependencies = loader.dependency_requirements.some((entry) => {
      switch (entry) {
        case "python-runtime":
          return !runtimeProbeDetected(latestLocalRuntimeProbeSnapshot(input.record), "python-runtime-presence");
        case "comfyui-runtime":
        case "diffusers-runtime":
        case "cuda-runtime":
          return !runtimeProbeDetected(latestLocalRuntimeProbeSnapshot(input.record), "inference-runtime-presence");
        case "model-weights":
          return !runtimeProbeDetected(latestLocalRuntimeProbeSnapshot(input.record), "local-model-directory-presence");
        case "ffmpeg":
          return !runtimeProbeDetected(latestLocalRuntimeProbeSnapshot(input.record), "ffmpeg-availability");
        default:
          return false;
      }
    });
    const supportsResolution = loader.supported_resolution.includes(input.desiredResolution);
    const supportsDuration = loader.supported_duration >= input.desiredDurationSeconds;
    const continuityCompatible = input.continuityPriority !== "high" || loader.continuity_support !== "limited";
    const vramCompatible = !preferredHardware || preferredHardware.gpu_vram_gb >= loader.estimated_vram;
    const runtimeCompatible = !matchingRuntime || !preferredHardware || matchingRuntime.supported_backends.includes(preferredHardware.accelerator_backend);
    const nextStatus: CinematicLocalModelLoaderStatus = missingDependencies
      ? "dependency-review"
      : supportsResolution && supportsDuration && continuityCompatible && vramCompatible && runtimeCompatible && matchingModel && matchingRuntime
        ? "activation-ready"
        : runtimeCompatible
          ? "registered"
          : "blocked";
    return {
      ...loader,
      status: nextStatus,
    };
  });
}

function validateModelRuntimeCompatibility(input: {
  record: CinematicProductionMemoryRecord;
  loaderRegistry: CinematicLocalModelLoaderRecord[];
  desiredResolution: CinematicVideoResolution;
  desiredDurationSeconds: number;
  continuityPriority: "low" | "medium" | "high";
}): CinematicModelRuntimeCompatibilityValidation {
  const preferredHardware = resolvePreferredLocalHardware({
    record: input.record,
    model: null,
    desiredResolution: input.desiredResolution,
    desiredDurationSeconds: input.desiredDurationSeconds,
  });
  const preferredRuntime = resolvePreferredLocalRuntime({
    record: input.record,
    hardware: preferredHardware,
  });
  const probeSnapshot = latestLocalRuntimeProbeSnapshot(input.record);
  const issues = input.loaderRegistry.flatMap((loader) => {
    const runtime = input.record.local_runtime_capability_registry.find((entry) => entry.runtime_id === loader.runtime_target) ?? null;
    const model = input.record.local_model_registry.find((entry) => entry.display_name === loader.model_name) ?? null;
    const nextIssues: CinematicModelRuntimeCompatibilityIssue[] = [];
    if (!runtime || (preferredHardware && !runtime.supported_backends.includes(preferredHardware.accelerator_backend))) {
      nextIssues.push({ code: "model-runtime-mismatch", loader_id: loader.loader_id, detail: `${loader.model_name} does not match the preferred runtime backend.` });
    }
    if (preferredHardware && preferredHardware.gpu_vram_gb < loader.estimated_vram) {
      nextIssues.push({ code: "insufficient-vram", loader_id: loader.loader_id, detail: `${loader.model_name} needs ${loader.estimated_vram}GB VRAM but only ${preferredHardware.gpu_vram_gb}GB is profiled.` });
    }
    if (loader.dependency_requirements.some((entry) => {
      switch (entry) {
        case "python-runtime":
          return !runtimeProbeDetected(probeSnapshot, "python-runtime-presence");
        case "comfyui-runtime":
        case "diffusers-runtime":
        case "cuda-runtime":
          return !runtimeProbeDetected(probeSnapshot, "inference-runtime-presence");
        case "model-weights":
          return !runtimeProbeDetected(probeSnapshot, "local-model-directory-presence");
        case "ffmpeg":
          return !runtimeProbeDetected(probeSnapshot, "ffmpeg-availability");
        default:
          return false;
      }
    })) {
      nextIssues.push({ code: "missing-dependencies", loader_id: loader.loader_id, detail: `${loader.model_name} is missing at least one dependency signal.` });
    }
    if (loader.supported_duration < input.desiredDurationSeconds) {
      nextIssues.push({ code: "unsupported-duration", loader_id: loader.loader_id, detail: `${loader.model_name} only supports ${loader.supported_duration}s.` });
    }
    if (!loader.supported_resolution.includes(input.desiredResolution)) {
      nextIssues.push({ code: "unsupported-resolution", loader_id: loader.loader_id, detail: `${loader.model_name} does not support ${input.desiredResolution}.` });
    }
    if (!normalizeText(loader.model_path)) {
      nextIssues.push({ code: "missing-model-path", loader_id: loader.loader_id, detail: `${loader.model_name} does not have a model path recorded.` });
    }
    if (input.continuityPriority === "high" && loader.continuity_support === "limited") {
      nextIssues.push({ code: "unsupported-continuity-mode", loader_id: loader.loader_id, detail: `${loader.model_name} is not suitable for high continuity planning.` });
    }
    if (!model) {
      nextIssues.push({ code: "missing-model-path", loader_id: loader.loader_id, detail: `${loader.model_name} is not mapped to a registered model profile.` });
    }
    return nextIssues;
  });
  const preferredLoader = input.loaderRegistry.find((entry) => entry.status === "activation-ready") ?? input.loaderRegistry[0] ?? null;
  const fallbackRuntime = input.record.local_runtime_capability_registry.find(
    (entry) => entry.runtime_id !== preferredLoader?.runtime_target && entry.status !== "candidate",
  ) ?? input.record.local_runtime_capability_registry.find((entry) => entry.runtime_id !== preferredLoader?.runtime_target) ?? null;
  const blockers = uniqueNormalizedStrings(issues.map((entry) => entry.detail));
  return {
    valid: issues.length === 0,
    preferred_loader_id: preferredLoader?.loader_id ?? null,
    issues,
    blockers,
    fallback_runtime_id: fallbackRuntime?.runtime_id ?? preferredRuntime?.runtime_id ?? null,
  };
}

function buildRuntimeActivationSimulationStates(input: {
  loaderRegistry: CinematicLocalModelLoaderRecord[];
  compatibility: CinematicModelRuntimeCompatibilityValidation;
}): CinematicRuntimeActivationSimulationState[] {
  const blocked = !input.compatibility.valid;
  const preferredLoader = input.loaderRegistry.find((entry) => entry.loader_id === input.compatibility.preferred_loader_id) ?? input.loaderRegistry[0] ?? null;
  const states: Array<Omit<CinematicRuntimeActivationSimulationState, "order">> = [
    {
      state: "loader_registered",
      simulated: true,
      detail: preferredLoader ? `Loader ${preferredLoader.loader_id} is registered for future activation.` : "No loader is registered for activation yet.",
      blockers: preferredLoader ? [] : ["No loader registered."],
    },
    {
      state: "dependency_checking",
      simulated: true,
      detail: "Dependency signals are inspected from deterministic runtime probes only.",
      blockers: input.compatibility.issues.filter((entry) => entry.code === "missing-dependencies").map((entry) => entry.detail),
    },
    {
      state: "runtime_preparing",
      simulated: true,
      detail: "Runtime preparation remains simulated and does not launch any local process.",
      blockers: input.compatibility.issues.filter((entry) => entry.code === "model-runtime-mismatch").map((entry) => entry.detail),
    },
    {
      state: "model_loading_simulated",
      simulated: true,
      detail: "Model loading is inferred from loader metadata and probe evidence, not executed.",
      blockers: input.compatibility.issues.filter((entry) => entry.code === "missing-model-path").map((entry) => entry.detail),
    },
    {
      state: "vram_reserving",
      simulated: true,
      detail: "VRAM reservation remains a planning estimate only.",
      blockers: input.compatibility.issues.filter((entry) => entry.code === "insufficient-vram").map((entry) => entry.detail),
    },
    {
      state: blocked ? "activation_blocked" : "inference_ready_simulated",
      simulated: true,
      detail: blocked
        ? "Activation remains blocked behind compatibility issues and governance rules."
        : "Inference readiness is simulated for future reviewed bridge work only.",
      blockers: blocked ? input.compatibility.blockers : [],
    },
    {
      state: blocked ? "activation_recovering" : "activation_archived",
      simulated: true,
      detail: blocked
        ? "Recovery steps are generated instead of attempting activation."
        : "Activation evidence is archived without loading models or running inference.",
      blockers: blocked ? input.compatibility.blockers : [],
    },
  ];
  return states.map((entry, index) => ({
    ...entry,
    order: index + 1,
  }));
}

function buildActivationFailureRecoveryPlan(input: {
  record: CinematicProductionMemoryRecord;
  compatibility: CinematicModelRuntimeCompatibilityValidation;
  loaderRegistry: CinematicLocalModelLoaderRecord[];
}): CinematicActivationFailureRecoveryPlan {
  const causes: CinematicActivationFailureCause[] = [];
  if (input.compatibility.issues.some((entry) => entry.code === "model-runtime-mismatch")) {
    causes.push("missing-runtime");
  }
  if (input.compatibility.issues.some((entry) => entry.code === "missing-model-path")) {
    causes.push("missing-model-files");
  }
  if (input.compatibility.issues.some((entry) => entry.code === "insufficient-vram")) {
    causes.push("insufficient-vram");
  }
  if (input.compatibility.issues.some((entry) => entry.code === "missing-dependencies")) {
    causes.push("dependency-mismatch");
  }
  if (input.record.local_hardware_profiles.some((entry) => entry.storage_free_gb < 40)) {
    causes.push("storage-pressure");
  }
  if (input.record.local_provider_routing_rules.some((entry) => /fall back/i.test(entry))) {
    causes.push("unsupported-provider-route");
  }
  if (input.loaderRegistry.some((entry) => /cache/i.test(entry.model_path) && entry.status === "blocked")) {
    causes.push("corrupted-cache");
  }
  const uniqueCauses = [...new Set(causes)];
  const fallbackRuntimeId = input.compatibility.fallback_runtime_id;
  const nextSafeSteps = uniqueCauses.map((cause, index) => ({
    cause,
    sequence_order: index + 1,
    detail: (() => {
      switch (cause) {
        case "missing-runtime":
          return `Review runtime compatibility and prefer ${fallbackRuntimeId ?? "a fallback runtime"} before any future bridge.`;
        case "missing-model-files":
          return "Confirm model path registration and retain model loading as simulated-only until files are verified manually.";
        case "insufficient-vram":
          return "Reduce requested resolution or duration and keep activation serialized in planning-only mode.";
        case "dependency-mismatch":
          return "Record the missing dependency evidence in readiness notes without installing anything automatically.";
        case "storage-pressure":
          return "Reserve storage headroom manually before reviewing cache-heavy activation scaffolds.";
        case "unsupported-provider-route":
          return "Fallback to offline-planning-mode or hybrid escalation rather than attempting unsupported local routing.";
        case "corrupted-cache":
          return "Treat cache repair as a separate reviewed maintenance task outside this sandbox layer.";
      }
    })(),
  }));
  return {
    blocked: uniqueCauses.length > 0,
    causes: uniqueCauses,
    fallback_runtime_id: fallbackRuntimeId,
    next_safe_steps: nextSafeSteps,
  };
}

function buildFutureActivationPlan(input: {
  compatibility: CinematicModelRuntimeCompatibilityValidation;
}): CinematicFutureActivationPlan {
  return {
    future_frame_synthesis_activation: true,
    future_temporal_pipeline_activation: true,
    future_upscale_activation: true,
    future_render_packaging_activation: true,
    future_local_only_execution_mode: false,
    notes: uniqueNormalizedStrings([
      "Future frame synthesis activation remains scaffold-only and requires a separate reviewed bridge.",
      "Future temporal pipeline activation remains continuity-governed and non-executing in this layer.",
      "Future upscale activation remains packaging-adjacent planning only.",
      "Future render packaging activation remains blocked behind FFmpeg evidence and explicit review.",
      input.compatibility.valid
        ? "Compatibility is sufficient for future reviewed activation planning, not live runtime activation."
        : "Compatibility blockers still prevent any future activation bridge promotion.",
    ]),
  };
}

async function writablePathsFromCandidates(root: string, candidates: string[]): Promise<string[]> {
  const resolved = resolveCandidatePaths(root, candidates).filter((entry) => existsSync(entry));
  const writable: string[] = [];
  for (const candidate of resolved) {
    try {
      await access(candidate, constants.W_OK);
      writable.push(candidate);
    } catch {
      continue;
    }
  }
  return uniqueNormalizedStrings(writable);
}

async function buildDryRuntimeBootstrapValidation(input: {
  root: string;
  record: CinematicProductionMemoryRecord;
  loaderRegistry: CinematicLocalModelLoaderRecord[];
}): Promise<CinematicDryRuntimeBootstrapValidation> {
  const snapshot = latestLocalRuntimeProbeSnapshot(input.record);
  const runtimePaths = existingPathsFromCandidates(input.root, input.record.local_runtime_probe_path_hints.inference_runtime_paths);
  const runtimeBinaryCandidates = [
    ...input.record.local_runtime_probe_path_hints.python_paths,
    ".venv/Scripts/python.exe",
    "ComfyUI/main.py",
  ];
  const runtimeBinaries = uniqueNormalizedStrings([
    ...existingPathsFromCandidates(input.root, runtimeBinaryCandidates),
    ...findExecutablesInPath(["python.exe", "python"]),
  ]);
  const pythonPaths = uniqueNormalizedStrings([
    ...existingPathsFromCandidates(input.root, input.record.local_runtime_probe_path_hints.python_paths),
    ...findExecutablesInPath(["python.exe", "python"]),
  ]);
  const ffmpegPaths = uniqueNormalizedStrings([
    ...existingPathsFromCandidates(input.root, input.record.local_runtime_probe_path_hints.ffmpeg_paths),
    ...findExecutablesInPath(["ffmpeg.exe", "ffmpeg"]),
  ]);
  const modelPaths = uniqueNormalizedStrings([
    ...existingPathsFromCandidates(input.root, input.record.local_runtime_probe_path_hints.local_model_paths),
    ...existingPathsFromCandidates(input.root, input.loaderRegistry.map((entry) => entry.model_path)),
  ]);
  const dependencyFiles = existingPathsFromCandidates(input.root, ["requirements.txt", "web/package.json", "package.json"]);
  const writableCaches = await writablePathsFromCandidates(input.root, [
    ...input.record.local_runtime_probe_path_hints.local_model_paths,
    "models",
    ".aie",
    "runner_artifacts",
  ]);
  const preferredStorageRequired = Math.max(...input.record.local_model_registry.map((entry) => entry.storage_requirement_gb), 0);
  const storageReady = input.record.local_hardware_profiles.some((entry) => entry.storage_free_gb >= preferredStorageRequired && entry.status !== "planned");
  const checks: CinematicDryRuntimeBootstrapCheck[] = [
    {
      check: "runtime-path-validity",
      passed: runtimePaths.length > 0,
      detail: runtimePaths.length > 0
        ? `Detected ${runtimePaths.length} runtime path candidate(s) without launching anything.`
        : "No configured runtime path is visible for dry bootstrap review.",
      candidate_paths: resolveCandidatePaths(input.root, input.record.local_runtime_probe_path_hints.inference_runtime_paths),
      detected_paths: runtimePaths,
    },
    {
      check: "runtime-binary-presence",
      passed: runtimeBinaries.length > 0,
      detail: runtimeBinaries.length > 0
        ? `Detected ${runtimeBinaries.length} runtime binary candidate(s) for dry initialization review.`
        : "No runtime bootstrap binary or entry script is visible for dry review.",
      candidate_paths: resolveCandidatePaths(input.root, runtimeBinaryCandidates),
      detected_paths: runtimeBinaries,
    },
    {
      check: "python-environment-visibility",
      passed: pythonPaths.length > 0 || runtimeProbeDetected(snapshot, "python-runtime-presence"),
      detail: pythonPaths.length > 0 || runtimeProbeDetected(snapshot, "python-runtime-presence")
        ? "A Python environment is visible to bounded dry bootstrap checks."
        : "Python environment visibility is still unverified for dry bootstrap.",
      candidate_paths: resolveCandidatePaths(input.root, input.record.local_runtime_probe_path_hints.python_paths),
      detected_paths: pythonPaths,
    },
    {
      check: "ffmpeg-visibility",
      passed: ffmpegPaths.length > 0 || runtimeProbeDetected(snapshot, "ffmpeg-availability"),
      detail: ffmpegPaths.length > 0 || runtimeProbeDetected(snapshot, "ffmpeg-availability")
        ? "FFmpeg visibility is available for dry packaging bootstrap checks."
        : "FFmpeg visibility is still missing for dry bootstrap review.",
      candidate_paths: resolveCandidatePaths(input.root, input.record.local_runtime_probe_path_hints.ffmpeg_paths),
      detected_paths: ffmpegPaths,
    },
    {
      check: "model-directory-visibility",
      passed: modelPaths.length > 0 || runtimeProbeDetected(snapshot, "local-model-directory-presence"),
      detail: modelPaths.length > 0 || runtimeProbeDetected(snapshot, "local-model-directory-presence")
        ? "Model directories are visible for dry initialization checks."
        : "No model directory is visible for dry initialization checks.",
      candidate_paths: resolveCandidatePaths(input.root, [...input.record.local_runtime_probe_path_hints.local_model_paths, ...input.loaderRegistry.map((entry) => entry.model_path)]),
      detected_paths: modelPaths,
    },
    {
      check: "dependency-file-visibility",
      passed: dependencyFiles.length > 0,
      detail: dependencyFiles.length > 0
        ? `Detected ${dependencyFiles.length} dependency file candidate(s) for integrity review.`
        : "No dependency file is visible for dry bootstrap integrity review.",
      candidate_paths: resolveCandidatePaths(input.root, ["requirements.txt", "web/package.json", "package.json"]),
      detected_paths: dependencyFiles,
    },
    {
      check: "storage-readiness",
      passed: storageReady || runtimeProbeDetected(snapshot, "storage-space-estimate"),
      detail: storageReady || runtimeProbeDetected(snapshot, "storage-space-estimate")
        ? "Stored hardware estimates indicate storage headroom for dry bootstrap planning."
        : "Storage readiness is still below the modeled threshold for dry bootstrap planning.",
      candidate_paths: [],
      detected_paths: storageReady ? ["stored-hardware-estimate"] : [],
    },
    {
      check: "writable-cache-locations",
      passed: writableCaches.length > 0,
      detail: writableCaches.length > 0
        ? `Detected ${writableCaches.length} writable cache location(s) for dry bootstrap planning.`
        : "No writable cache location is visible for dry bootstrap planning.",
      candidate_paths: resolveCandidatePaths(input.root, [...input.record.local_runtime_probe_path_hints.local_model_paths, "models", ".aie", "runner_artifacts"]),
      detected_paths: writableCaches,
    },
  ];
  const blockers = uniqueNormalizedStrings(checks.filter((entry) => !entry.passed).map((entry) => entry.detail));
  const missingDependencies = uniqueNormalizedStrings([
    ...(checks.find((entry) => entry.check === "runtime-path-validity")?.passed ? [] : ["runtime path visibility"]),
    ...(checks.find((entry) => entry.check === "runtime-binary-presence")?.passed ? [] : ["runtime bootstrap binary"]),
    ...(checks.find((entry) => entry.check === "dependency-file-visibility")?.passed ? [] : ["dependency file visibility"]),
    ...(checks.find((entry) => entry.check === "writable-cache-locations")?.passed ? [] : ["writable cache location"]),
  ]);
  return {
    valid: blockers.length === 0,
    checks,
    activation_blockers: blockers,
    missing_dependencies: missingDependencies,
  };
}

function buildExecutionBoundaryState(input: {
  record: CinematicProductionMemoryRecord;
  bootstrap: CinematicDryRuntimeBootstrapValidation;
  integrity: CinematicRuntimeIntegrityValidation;
}): CinematicExecutionBoundaryState {
  const blocked = !input.bootstrap.valid || !input.integrity.valid || input.record.generation_budget_policy.sandbox_only_mode;
  const currentStatus: CinematicExecutionBoundaryStatus = blocked
    ? input.bootstrap.checks.some((entry) => entry.passed)
      ? "partially_activated"
      : "execution_blocked"
    : "dry_initialized";
  return {
    boundary_id: `execution-boundary-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`,
    source: "controlled-local-inference-bootstrap",
    recorded_at: new Date().toISOString(),
    current_status: currentStatus,
    tracked_statuses: uniqueNormalizedStrings([
      "simulated",
      currentStatus,
      "inference_disabled",
      "rendering_disabled",
      blocked ? "execution_blocked" : null,
    ]) as CinematicExecutionBoundaryStatus[],
    activation_blockers: uniqueNormalizedStrings([...input.bootstrap.activation_blockers, ...input.integrity.blockers]),
    disabled_execution_reasons: uniqueNormalizedStrings([
      "Actual inference execution remains disabled in this layer.",
      "Frame rendering remains disabled in this layer.",
      ...(input.record.generation_budget_policy.sandbox_only_mode ? ["Sandbox-only governance explicitly blocks execution."] : []),
    ]),
    next_activation_milestone: blocked
      ? "Clear dry bootstrap and integrity blockers before any reviewed bridge can attempt dry model initialization."
      : "Dry model initialization scaffold may be reviewed next, but live inference remains disabled.",
    missing_dependencies: uniqueNormalizedStrings([...input.bootstrap.missing_dependencies, ...input.integrity.missing_dependencies]),
    governance_restrictions: input.record.local_inference_governance_rules,
  };
}

async function buildRuntimeIntegrityValidation(input: {
  root: string;
  record: CinematicProductionMemoryRecord;
  loaderRegistry: CinematicLocalModelLoaderRecord[];
  bootstrap: CinematicDryRuntimeBootstrapValidation;
  desiredResolution: CinematicVideoResolution;
  desiredDurationSeconds: number;
}): Promise<CinematicRuntimeIntegrityValidation> {
  const preferredHardware = resolvePreferredLocalHardware({
    record: input.record,
    model: null,
    desiredResolution: input.desiredResolution,
    desiredDurationSeconds: input.desiredDurationSeconds,
  });
  const preferredRuntime = resolvePreferredLocalRuntime({
    record: input.record,
    hardware: preferredHardware,
  });
  const modelPaths = existingPathsFromCandidates(input.root, input.loaderRegistry.map((entry) => entry.model_path));
  const cachePaths = await writablePathsFromCandidates(input.root, ["models", ".aie", "runner_artifacts"]);
  const issues: CinematicRuntimeIntegrityIssue[] = [];
  if (!input.bootstrap.checks.find((entry) => entry.check === "runtime-binary-presence")?.passed) {
    issues.push({ code: "missing-runtime-binaries", detail: "Runtime bootstrap binary presence is not verified." });
  }
  if (modelPaths.length === 0) {
    issues.push({ code: "invalid-model-paths", detail: "No modeled loader path currently resolves to a visible model directory." });
  }
  if (preferredRuntime?.status === "candidate" || preferredRuntime?.detection_method === "future-runtime-probe") {
    issues.push({ code: "unsupported-runtime-versions", detail: `${preferredRuntime?.display_name ?? "Preferred runtime"} is still version-unverified for dry bootstrap.` });
  }
  if (input.loaderRegistry.some((entry) => entry.status === "dependency-review" || entry.status === "blocked")) {
    issues.push({ code: "incompatible-dependency-sets", detail: "One or more loader/runtime dependency sets remain incompatible or incomplete." });
  }
  if (cachePaths.length === 0) {
    issues.push({ code: "invalid-cache-locations", detail: "No writable cache location is available for dry bootstrap planning." });
  }
  if (!preferredHardware || preferredHardware.status === "planned") {
    issues.push({ code: "unsupported-hardware-profile", detail: "Preferred hardware profile remains unvalidated for the requested bootstrap profile." });
  }
  const blockers = uniqueNormalizedStrings(issues.map((entry) => entry.detail));
  const missingDependencies = uniqueNormalizedStrings([
    ...(issues.some((entry) => entry.code === "missing-runtime-binaries") ? ["runtime bootstrap binary"] : []),
    ...(issues.some((entry) => entry.code === "invalid-model-paths") ? ["validated model path"] : []),
    ...(issues.some((entry) => entry.code === "unsupported-runtime-versions") ? ["runtime version evidence"] : []),
    ...(issues.some((entry) => entry.code === "incompatible-dependency-sets") ? ["compatible dependency set"] : []),
    ...(issues.some((entry) => entry.code === "invalid-cache-locations") ? ["writable cache path"] : []),
    ...(issues.some((entry) => entry.code === "unsupported-hardware-profile") ? ["validated hardware profile"] : []),
  ]);
  return {
    valid: issues.length === 0,
    issues,
    blockers,
    missing_dependencies: missingDependencies,
  };
}

function previousMilestoneDelta(record: CinematicProductionMemoryRecord, milestone: CinematicReadinessMilestoneKey): number | null {
  return record.readiness_delta_tracking_history[0]?.milestones.find((entry) => entry.milestone === milestone)?.delta ?? null;
}

function readinessScoreRiskLevel(score: number, blockerCount: number): CinematicActivationReadinessRiskLevel {
  if (blockerCount >= 3 || score < 35) {
    return "critical";
  }
  if (blockerCount >= 2 || score < 50) {
    return "high";
  }
  if (blockerCount >= 1 || score < 70) {
    return "medium";
  }
  return "low";
}

function readinessScoreTrend(delta: number | null): CinematicActivationReadinessTrend {
  if (delta === null) {
    return "new";
  }
  if (delta > 0) {
    return "accelerating";
  }
  if (delta < 0) {
    return "decelerating";
  }
  return "flat";
}

function buildActivationReadinessScores(input: {
  record: CinematicProductionMemoryRecord;
  readiness: CinematicLocalInferenceReadinessReport;
  bootstrap: CinematicDryRuntimeBootstrapValidation;
  integrity: CinematicRuntimeIntegrityValidation;
  boundary: CinematicExecutionBoundaryState;
  loaderRegistry: CinematicLocalModelLoaderRecord[];
}): CinematicActivationReadinessScoring {
  const milestoneMap: Record<CinematicActivationReadinessDimension, CinematicReadinessMilestoneKey> = {
    "runtime-readiness": "local-runtime-readiness",
    "loader-readiness": "local-inference-readiness",
    "inference-readiness": "local-inference-readiness",
    "renderer-readiness": "local-renderer-readiness",
    "continuity-readiness": "continuity-preserving-local-generation",
    "offline-readiness": "hybrid-local-cloud-orchestration",
  };
  const progressByMilestone = new Map(input.readiness.milestone_progress.map((entry) => [entry.milestone, entry]));
  const loaderReadyCount = input.loaderRegistry.filter((entry) => entry.status === "activation-ready").length;
  const scores: CinematicActivationReadinessScore[] = [
    {
      dimension: "runtime-readiness",
      score: clampPercentage((progressByMilestone.get("local-runtime-readiness")?.percentage ?? 0) + (input.bootstrap.valid ? 10 : 0)),
      confidence: progressByMilestone.get("local-runtime-readiness")?.confidence ?? "low",
      blockers: uniqueNormalizedStrings([...input.bootstrap.activation_blockers, ...input.integrity.issues.filter((entry) => entry.code === "missing-runtime-binaries" || entry.code === "unsupported-runtime-versions").map((entry) => entry.detail)]),
      risk_level: readinessScoreRiskLevel(progressByMilestone.get("local-runtime-readiness")?.percentage ?? 0, input.bootstrap.activation_blockers.length),
      trend: readinessScoreTrend(previousMilestoneDelta(input.record, milestoneMap["runtime-readiness"])),
    },
    {
      dimension: "loader-readiness",
      score: percentageFromChecks([
        { passed: input.loaderRegistry.length > 0, weight: 35 },
        { passed: loaderReadyCount > 0, weight: 45 },
        { passed: input.bootstrap.checks.find((entry) => entry.check === "model-directory-visibility")?.passed ?? false, weight: 20 },
      ]),
      confidence: readinessConfidenceFromPercentage(loaderReadyCount > 0 ? 70 : 35, input.loaderRegistry.length),
      blockers: uniqueNormalizedStrings(input.loaderRegistry.filter((entry) => entry.status !== "activation-ready").map((entry) => `${entry.loader_id} remains ${entry.status}.`)),
      risk_level: readinessScoreRiskLevel(loaderReadyCount > 0 ? 70 : 35, input.loaderRegistry.filter((entry) => entry.status !== "activation-ready").length),
      trend: readinessScoreTrend(previousMilestoneDelta(input.record, milestoneMap["loader-readiness"])),
    },
    {
      dimension: "inference-readiness",
      score: clampPercentage(Math.max(0, (progressByMilestone.get("local-inference-readiness")?.percentage ?? 0) - 15)),
      confidence: progressByMilestone.get("local-inference-readiness")?.confidence ?? "low",
      blockers: input.boundary.disabled_execution_reasons,
      risk_level: readinessScoreRiskLevel(progressByMilestone.get("local-inference-readiness")?.percentage ?? 0, input.boundary.activation_blockers.length),
      trend: readinessScoreTrend(previousMilestoneDelta(input.record, milestoneMap["inference-readiness"])),
    },
    {
      dimension: "renderer-readiness",
      score: clampPercentage((progressByMilestone.get("local-renderer-readiness")?.percentage ?? 0) + ((input.bootstrap.checks.find((entry) => entry.check === "ffmpeg-visibility")?.passed ?? false) ? 5 : 0)),
      confidence: progressByMilestone.get("local-renderer-readiness")?.confidence ?? "low",
      blockers: uniqueNormalizedStrings([
        ...(input.bootstrap.checks.find((entry) => entry.check === "ffmpeg-visibility")?.passed ? [] : ["FFmpeg visibility is still missing for renderer packaging."]),
        ...input.boundary.disabled_execution_reasons,
      ]),
      risk_level: readinessScoreRiskLevel(progressByMilestone.get("local-renderer-readiness")?.percentage ?? 0, input.boundary.activation_blockers.length),
      trend: readinessScoreTrend(previousMilestoneDelta(input.record, milestoneMap["renderer-readiness"])),
    },
    {
      dimension: "continuity-readiness",
      score: progressByMilestone.get("continuity-preserving-local-generation")?.percentage ?? 0,
      confidence: progressByMilestone.get("continuity-preserving-local-generation")?.confidence ?? "low",
      blockers: uniqueNormalizedStrings([
        ...input.loaderRegistry.filter((entry) => entry.continuity_support === "limited").map((entry) => `${entry.loader_id} only has limited continuity support.`),
      ]),
      risk_level: readinessScoreRiskLevel(progressByMilestone.get("continuity-preserving-local-generation")?.percentage ?? 0, input.loaderRegistry.filter((entry) => entry.continuity_support === "limited").length),
      trend: readinessScoreTrend(previousMilestoneDelta(input.record, milestoneMap["continuity-readiness"])),
    },
    {
      dimension: "offline-readiness",
      score: percentageFromChecks([
        { passed: input.loaderRegistry.some((entry) => entry.offline_viability), weight: 40 },
        { passed: input.bootstrap.valid, weight: 35 },
        { passed: input.readiness.recommended_routing_mode === "offline-planning-mode" || input.readiness.recommended_routing_mode === "future-local-inference-mode", weight: 25 },
      ]),
      confidence: readinessConfidenceFromPercentage(input.loaderRegistry.some((entry) => entry.offline_viability) ? 70 : 40, input.loaderRegistry.length),
      blockers: uniqueNormalizedStrings(input.loaderRegistry.filter((entry) => !entry.offline_viability).map((entry) => `${entry.loader_id} is not marked offline-viable.`)),
      risk_level: readinessScoreRiskLevel(input.loaderRegistry.some((entry) => entry.offline_viability) ? 70 : 40, input.loaderRegistry.filter((entry) => !entry.offline_viability).length),
      trend: readinessScoreTrend(previousMilestoneDelta(input.record, milestoneMap["offline-readiness"])),
    },
  ];
  return {
    recorded_at: new Date().toISOString(),
    scores,
  };
}

function buildControlledRuntimeProfiles(input: {
  record: CinematicProductionMemoryRecord;
  readiness: CinematicLocalInferenceReadinessReport;
  boundary: CinematicExecutionBoundaryState;
  integrity: CinematicRuntimeIntegrityValidation;
}): CinematicControlledRuntimeProfileEvaluation[] {
  return input.record.controlled_runtime_profiles.map((profile) => {
    const reasons: string[] = [];
    let viable = true;
    switch (profile.profile_id) {
      case "low_vram_safe":
        viable = input.record.local_hardware_profiles.some((entry) => entry.gpu_vram_gb > 0 && entry.gpu_vram_gb <= 12);
        if (!viable) reasons.push("No bounded low-VRAM hardware profile is currently recorded.");
        break;
      case "offline_safe":
        viable = input.readiness.recommended_routing_mode === "offline-planning-mode" || input.readiness.recommended_routing_mode === "future-local-inference-mode";
        if (!viable) reasons.push("Current routing recommendation is not offline-safe.");
        break;
      case "continuity_priority":
        viable = input.readiness.milestone_progress.find((entry) => entry.milestone === "continuity-preserving-local-generation")?.percentage !== undefined;
        if (!viable) reasons.push("Continuity readiness is not available.");
        break;
      case "cloud_hybrid_safe":
        viable = input.readiness.milestone_progress.find((entry) => entry.milestone === "hybrid-local-cloud-orchestration")?.percentage !== undefined;
        if (!viable) reasons.push("Hybrid orchestration readiness is not available.");
        break;
      case "cpu_fallback_safe":
        viable = input.record.local_hardware_profiles.some((entry) => entry.accelerator_backend === "cpu");
        if (!viable) reasons.push("No CPU fallback planning profile is currently recorded.");
        break;
    }
    if (input.integrity.issues.some((entry) => entry.code === "unsupported-hardware-profile")) {
      viable = profile.profile_id === "offline_safe" || profile.profile_id === "cloud_hybrid_safe";
      reasons.push("Hardware integrity blockers limit this profile.");
    }
    return {
      ...profile,
      viable,
      reasons: uniqueNormalizedStrings([...profile.governance_notes, ...reasons]),
      execution_boundary_status: input.boundary.current_status,
    };
  });
}

function buildFutureInferenceActivationScaffold(input: {
  boundary: CinematicExecutionBoundaryState;
  integrity: CinematicRuntimeIntegrityValidation;
}): CinematicFutureInferenceActivationPlan {
  return {
    dry_model_initialization: true,
    dry_vram_reservation: true,
    dry_scheduler_initialization: true,
    dry_pipeline_binding: true,
    dry_render_packaging: true,
    notes: uniqueNormalizedStrings([
      "Dry model initialization remains non-executing and review-only.",
      "Dry VRAM reservation remains a bookkeeping scaffold, not a real allocation.",
      "Dry scheduler initialization remains simulated without constructing a live pipeline.",
      "Dry pipeline binding remains descriptive until execution boundaries are explicitly relaxed.",
      "Dry render packaging remains disabled behind FFmpeg visibility and governance review.",
      `Current boundary status: ${input.boundary.current_status}.`,
      ...(input.integrity.valid ? [] : ["Integrity blockers must clear before any future dry initialization bridge expands."]),
    ]),
  };
}

function buildActivationAuthorityRegistry(input: {
  record: CinematicProductionMemoryRecord;
  boundary: CinematicExecutionBoundaryState;
  integrity: CinematicRuntimeIntegrityValidation;
}): CinematicActivationAuthorityRegistryEntry[] {
  const sharedGovernance = uniqueNormalizedStrings([
    ...input.record.local_inference_governance_rules,
    ...input.boundary.governance_restrictions,
  ]);
  const sharedRuntimeDependencies = uniqueNormalizedStrings([
    ...input.boundary.missing_dependencies,
    ...input.integrity.missing_dependencies,
  ]);
  return [
    {
      authority_id: "authority-manual-operator-gate",
      activation_scope: "gated_inference_prepare",
      allowed_transition: "dry_pipeline_binding->gated_inference_prepare",
      forbidden_transition: "gated_inference_prepare->inference_execute",
      required_approval: ["manual operator approval", "governance review record"],
      governance_dependencies: sharedGovernance,
      continuity_dependencies: ["continuity milestone evidence", "sequence continuity review"],
      runtime_dependencies: sharedRuntimeDependencies,
      execution_boundary_requirements: ["inference_disabled", "rendering_disabled", "execution_blocked"],
    },
    {
      authority_id: "authority-runtime-integrity-review",
      activation_scope: "gated_runtime_bind",
      allowed_transition: "gated_inference_prepare->gated_runtime_bind",
      forbidden_transition: "gated_runtime_bind->uncontrolled_runtime_launch",
      required_approval: ["runtime integrity approval", "manual operator approval"],
      governance_dependencies: ["runtime risk escalation remains advisory only"],
      continuity_dependencies: ["continuity context remains available during bind review"],
      runtime_dependencies: uniqueNormalizedStrings(["validated runtime paths", ...sharedRuntimeDependencies]),
      execution_boundary_requirements: ["simulated", "inference_disabled", "execution_blocked"],
    },
    {
      authority_id: "authority-continuity-governor",
      activation_scope: "gated_scheduler_prepare",
      allowed_transition: "gated_runtime_bind->gated_scheduler_prepare",
      forbidden_transition: "gated_scheduler_prepare->autonomous_retry_loops",
      required_approval: ["continuity review approval"],
      governance_dependencies: ["continuity blockers override throughput optimizations"],
      continuity_dependencies: ["continuity milestone evidence", "continuity-safe sequencing"],
      runtime_dependencies: ["dry scheduler planning only"],
      execution_boundary_requirements: ["partially_activated", "inference_disabled", "execution_blocked"],
    },
    {
      authority_id: "authority-render-output-governor",
      activation_scope: "gated_render_output_prepare",
      allowed_transition: "gated_temporal_stage_prepare->gated_render_output_prepare",
      forbidden_transition: "gated_render_output_prepare->renderer_activate",
      required_approval: ["renderer governance approval", "manual operator approval"],
      governance_dependencies: ["render packaging stays scaffold-only", "real renderer output remains hard-gated"],
      continuity_dependencies: ["temporal continuity review", "frame-stage preparation evidence"],
      runtime_dependencies: ["ffmpeg visibility", ...sharedRuntimeDependencies],
      execution_boundary_requirements: ["rendering_disabled", "execution_blocked"],
    },
  ];
}

function buildPreInferenceGateValidation(input: {
  record: CinematicProductionMemoryRecord;
  readiness: CinematicLocalInferenceReadinessReport;
  bootstrap: CinematicDryRuntimeBootstrapValidation;
  boundary: CinematicExecutionBoundaryState;
  integrity: CinematicRuntimeIntegrityValidation;
  futureInferenceActivation: CinematicFutureInferenceActivationPlan;
}): CinematicPreInferenceGateValidation {
  const continuityProgress = input.readiness.milestone_progress.find((entry) => entry.milestone === "continuity-preserving-local-generation");
  const governanceApprovalPresent = input.record.generation_budget_policy.manual_approval_required
    && input.record.local_inference_governance_rules.length > 0
    && input.record.manual_approval_workflow.length > 0;
  const checks: CinematicPreInferenceGateCheck[] = [
    {
      gate: "execution-boundary-intact",
      passed: input.boundary.tracked_statuses.includes("inference_disabled") && input.boundary.tracked_statuses.includes("rendering_disabled"),
      detail: "Execution boundary must keep inference and rendering disabled while precursor preparation is modeled.",
      blockers: input.boundary.activation_blockers,
    },
    {
      gate: "dry-bootstrap-complete",
      passed: input.bootstrap.valid,
      detail: "Dry bootstrap evidence must exist before any pre-inference preparation is considered.",
      blockers: input.bootstrap.activation_blockers,
    },
    {
      gate: "dry-model-initialization-complete",
      passed: input.futureInferenceActivation.dry_model_initialization,
      detail: "Dry model initialization remains scaffolded and non-executing.",
      blockers: input.futureInferenceActivation.dry_model_initialization ? [] : ["Dry model initialization scaffold is missing."],
    },
    {
      gate: "dry-scheduler-planning-complete",
      passed: input.futureInferenceActivation.dry_scheduler_initialization,
      detail: "Dry scheduler planning must be present before gated scheduler preparation can be sequenced.",
      blockers: input.futureInferenceActivation.dry_scheduler_initialization ? [] : ["Dry scheduler planning scaffold is missing."],
    },
    {
      gate: "dry-pipeline-binding-complete",
      passed: input.futureInferenceActivation.dry_pipeline_binding,
      detail: "Dry pipeline binding must remain descriptive only and recorded before pre-inference gating advances.",
      blockers: input.futureInferenceActivation.dry_pipeline_binding ? [] : ["Dry pipeline binding scaffold is missing."],
    },
    {
      gate: "governance-approval-present",
      passed: governanceApprovalPresent,
      detail: "Governance approval metadata must remain present even when no real execution is permitted.",
      blockers: governanceApprovalPresent ? [] : ["Governance approval metadata is incomplete."],
    },
    {
      gate: "continuity-state-available",
      passed: Boolean(input.record.gameplay_context.current_sequence) && Boolean(continuityProgress),
      detail: "Continuity state must stay visible before future inference-entry sequencing is prepared.",
      blockers: continuityProgress ? [] : ["Continuity milestone evidence is not available."],
    },
    {
      gate: "runtime-integrity-acceptable",
      passed: input.integrity.valid,
      detail: "Runtime integrity remains a hard safety gate even for simulated preparation.",
      blockers: input.integrity.blockers,
    },
  ];
  const blockedTransitions = checks
    .filter((entry) => !entry.passed)
    .map((entry) => entry.gate.replace(/-/g, "_"));
  return {
    validation_id: `pre-inference-gates-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    valid: checks.every((entry) => entry.passed),
    checks,
    blocked_transitions: blockedTransitions,
    next_unlock_condition: checks.find((entry) => !entry.passed)?.detail ?? "All precursor gates are satisfied, but execution remains hard-gated.",
  };
}

function buildInferenceEntrySequencing(input: {
  gateValidation: CinematicPreInferenceGateValidation;
}): CinematicInferenceEntrySequencing {
  const stages: CinematicInferenceEntrySequenceStage[] = [
    "gated_inference_prepare",
    "gated_runtime_bind",
    "gated_scheduler_prepare",
    "gated_frame_stage_prepare",
    "gated_temporal_stage_prepare",
    "gated_render_output_prepare",
  ];
  let blocked = !input.gateValidation.valid;
  const states = stages.map((stage, index) => {
    const state = {
      stage,
      order: index + 1,
      simulated: true as const,
      status: blocked ? "blocked" as const : "ready" as const,
      detail: blocked
        ? `Stage ${stage} remains simulated-only because pre-inference gates still block advancement.`
        : `Stage ${stage} is sequenced for future reviewed activation preparation only.`,
      blockers: blocked ? input.gateValidation.blocked_transitions : [],
    };
    blocked = true;
    return state;
  });
  return {
    sequencing_id: `inference-entry-sequencing-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    stages: states,
    next_stage: states.find((entry) => entry.status === "ready")?.stage ?? null,
  };
}

function buildForbiddenExecutionStateEnforcement(input: {
  boundary: CinematicExecutionBoundaryState;
}): CinematicForbiddenExecutionStateEnforcement {
  const reason = `Execution boundary ${input.boundary.current_status} keeps live execution blocked in this precursor layer.`;
  return {
    enforcement_id: `forbidden-execution-states-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    states: [
      "inference_execute",
      "frame_generate",
      "renderer_activate",
      "temporal_render",
      "unattended_execution",
      "autonomous_retry_loops",
      "uncontrolled_runtime_launch",
    ].map((state) => ({
      state,
      blocked: true as const,
      reason,
    })),
  };
}

function buildGovernanceEscalationModeling(input: {
  record: CinematicProductionMemoryRecord;
  readiness: CinematicLocalInferenceReadinessReport;
  integrity: CinematicRuntimeIntegrityValidation;
  gateValidation: CinematicPreInferenceGateValidation;
  loaderRegistry: CinematicLocalModelLoaderRecord[];
}): CinematicGovernanceEscalationModeling {
  const continuityProgress = input.readiness.milestone_progress.find((entry) => entry.milestone === "continuity-preserving-local-generation")?.percentage ?? 0;
  const offlineMode = input.readiness.recommended_routing_mode === "offline-planning-mode";
  return {
    escalation_id: `governance-escalation-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    scenarios: [
      {
        escalation: "manual-approval-escalation",
        triggered: !input.gateValidation.checks.find((entry) => entry.gate === "governance-approval-present")?.passed,
        detail: "Manual approval escalation remains the first gate before any future reviewed inference bridge can exist.",
        blockers: input.gateValidation.checks.find((entry) => entry.gate === "governance-approval-present")?.blockers ?? [],
      },
      {
        escalation: "runtime-risk-escalation",
        triggered: !input.integrity.valid,
        detail: "Runtime integrity issues escalate to manual review instead of any runtime launch.",
        blockers: input.integrity.blockers,
      },
      {
        escalation: "high-vram-escalation",
        triggered: input.loaderRegistry.some((entry) => entry.estimated_vram >= 14),
        detail: "High-VRAM candidates require an explicit reviewed escalation path before any future bind stage.",
        blockers: input.loaderRegistry.filter((entry) => entry.estimated_vram >= 14).map((entry) => `${entry.loader_id} requires ${entry.estimated_vram}GB VRAM.`),
      },
      {
        escalation: "offline-mode-escalation",
        triggered: offlineMode,
        detail: "Offline-mode escalation preserves non-networked planning when local runtime integrity is not yet acceptable.",
        blockers: offlineMode ? ["Routing remains in offline-planning-mode."] : [],
      },
      {
        escalation: "continuity-risk-escalation",
        triggered: continuityProgress < 70,
        detail: "Continuity risk escalation keeps continuity-safe preparation ahead of throughput or automation goals.",
        blockers: continuityProgress < 70 ? ["Continuity readiness remains below the governed threshold."] : [],
      },
      {
        escalation: "self-sustaining-mode-escalation",
        triggered: true,
        detail: "Self-sustaining mode remains forbidden and always escalates to governance review in this phase.",
        blockers: ["Self-sustaining generation remains explicitly forbidden.", ...input.record.local_inference_governance_rules],
      },
    ],
  };
}

function buildFutureUnlockConditions(input: {
  gateValidation: CinematicPreInferenceGateValidation;
}): CinematicFutureUnlockConditions {
  const blockedStates: CinematicForbiddenExecutionState[] = [
    "inference_execute",
    "frame_generate",
    "renderer_activate",
    "temporal_render",
    "unattended_execution",
    "autonomous_retry_loops",
    "uncontrolled_runtime_launch",
  ];
  const milestone = "reviewed-real-inference-bridge";
  const blockedPrerequisites = input.gateValidation.checks.filter((entry) => !entry.passed).map((entry) => entry.detail);
  return {
    condition_set_id: `future-unlock-conditions-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    milestone_unlocks_real_inference: milestone,
    conditions: [
      {
        unlock_id: "dry-inference-warmup",
        unlocked: false,
        prerequisites: uniqueNormalizedStrings(["pre-inference gate validation must pass", ...blockedPrerequisites]),
        execution_states_still_forbidden: blockedStates,
        unlocks_real_inference_at: milestone,
      },
      {
        unlock_id: "dry-frame-synthesis-warmup",
        unlocked: false,
        prerequisites: ["dry render packaging scaffold", "runtime integrity approval"],
        execution_states_still_forbidden: blockedStates,
        unlocks_real_inference_at: milestone,
      },
      {
        unlock_id: "gated-single-frame-inference",
        unlocked: false,
        prerequisites: ["manual operator approval", "single-frame reviewed bridge"],
        execution_states_still_forbidden: blockedStates,
        unlocks_real_inference_at: milestone,
      },
      {
        unlock_id: "gated-low-resolution-output",
        unlocked: false,
        prerequisites: ["bounded low-resolution review", "runtime bind approval"],
        execution_states_still_forbidden: blockedStates,
        unlocks_real_inference_at: milestone,
      },
      {
        unlock_id: "gated-temporal-output",
        unlocked: false,
        prerequisites: ["temporal stage approval", "continuity-safe evidence"],
        execution_states_still_forbidden: blockedStates,
        unlocks_real_inference_at: milestone,
      },
      {
        unlock_id: "governed-renderer-output",
        unlocked: false,
        prerequisites: ["renderer governance approval", "ffmpeg visibility", "manual operator approval"],
        execution_states_still_forbidden: blockedStates,
        unlocks_real_inference_at: milestone,
      },
    ],
  };
}

function buildExecutionTemperatureState(input: {
  readiness: CinematicLocalInferenceReadinessReport;
  gateValidation: CinematicPreInferenceGateValidation;
  frameStageReadiness: CinematicFrameStageReadinessValidation;
  warmup: CinematicDryInferenceWarmup;
  boundary: CinematicExecutionBoundaryState;
}): CinematicExecutionTemperatureStateRecord {
  const continuityProgress = input.readiness.milestone_progress.find((entry) => entry.milestone === "continuity-preserving-local-generation")?.percentage ?? 0;
  const blockedReasons = uniqueNormalizedStrings([
    ...input.gateValidation.checks.filter((entry) => !entry.passed).flatMap((entry) => entry.blockers),
    ...input.frameStageReadiness.checks.filter((entry) => !entry.passed).flatMap((entry) => entry.blockers),
  ]);
  const nextUnlockCondition = input.frameStageReadiness.next_unlock_condition;
  const governanceState = input.gateValidation.valid
    ? "governance-reviewed-but-hard-gated"
    : "governance-blocked-until-gates-pass";
  const continuityState = continuityProgress >= 70
    ? `continuity_ready_${continuityProgress}`
    : `continuity_blocked_${continuityProgress}`;
  return {
    temperature_id: `execution-temperature-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    current_state: "simulated_only",
    transitions: [
      {
        state: "cold",
        authority_trigger: "authority-manual-operator-gate",
        transition_reason: "Execution begins from a cold non-executing state with inference and rendering disabled.",
        blockers: blockedReasons,
        next_unlock_condition: nextUnlockCondition,
        governance_state: governanceState,
        continuity_state: continuityState,
      },
      {
        state: "warming",
        authority_trigger: "authority-runtime-integrity-review",
        transition_reason: "Dry scheduler and pipeline warmup planning is simulated without loading a model or launching a runtime.",
        blockers: blockedReasons,
        next_unlock_condition: input.warmup.next_unlock_condition,
        governance_state: governanceState,
        continuity_state: continuityState,
      },
      {
        state: "staged",
        authority_trigger: "authority-continuity-governor",
        transition_reason: "Frame-stage preparation and continuity state are staged for future reviewed single-frame preparation only.",
        blockers: blockedReasons,
        next_unlock_condition: nextUnlockCondition,
        governance_state: governanceState,
        continuity_state: continuityState,
      },
      {
        state: "gated",
        authority_trigger: "authority-manual-operator-gate",
        transition_reason: "Single-frame execution remains gated behind explicit approval and frame-stage readiness.",
        blockers: blockedReasons,
        next_unlock_condition: nextUnlockCondition,
        governance_state: governanceState,
        continuity_state: continuityState,
      },
      {
        state: "blocked",
        authority_trigger: "authority-manual-operator-gate",
        transition_reason: "Unsafe transitions remain blocked because frame-stage readiness and pre-inference gates are not fully satisfied.",
        blockers: blockedReasons,
        next_unlock_condition: nextUnlockCondition,
        governance_state: governanceState,
        continuity_state: continuityState,
      },
      {
        state: "simulated_only",
        authority_trigger: "authority-render-output-governor",
        transition_reason: `Execution temperature resolves to simulated_only while boundary ${input.boundary.current_status} preserves hard non-executing limits.`,
        blockers: blockedReasons,
        next_unlock_condition: "reviewed-single-frame-execution-bridge",
        governance_state: governanceState,
        continuity_state: continuityState,
      },
    ],
  };
}

function buildDryInferenceWarmup(input: {
  gateValidation: CinematicPreInferenceGateValidation;
  futureInferenceActivation: CinematicFutureInferenceActivationPlan;
  readiness: CinematicLocalInferenceReadinessReport;
  loaderRegistry: CinematicLocalModelLoaderRecord[];
}): CinematicDryInferenceWarmup {
  const continuityReady = (input.readiness.milestone_progress.find((entry) => entry.milestone === "continuity-preserving-local-generation")?.percentage ?? 0) >= 70;
  const gateBlockers = input.gateValidation.checks.filter((entry) => !entry.passed).flatMap((entry) => entry.blockers);
  return {
    warmup_id: `dry-inference-warmup-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    stages: [
      {
        stage: "scheduler_warmup",
        simulated: true,
        ready: input.futureInferenceActivation.dry_scheduler_initialization,
        detail: "Scheduler warmup is simulated as a governed preparation sequence only.",
        blockers: input.futureInferenceActivation.dry_scheduler_initialization ? [] : ["Dry scheduler planning scaffold is missing."],
      },
      {
        stage: "pipeline_warmup",
        simulated: true,
        ready: input.futureInferenceActivation.dry_pipeline_binding,
        detail: "Pipeline warmup remains descriptive and cannot bind or execute a live graph.",
        blockers: input.futureInferenceActivation.dry_pipeline_binding ? [] : ["Dry pipeline binding scaffold is missing."],
      },
      {
        stage: "frame_stage_preparation",
        simulated: true,
        ready: input.gateValidation.checks.find((entry) => entry.gate === "dry-pipeline-binding-complete")?.passed ?? false,
        detail: "Frame-stage preparation is modeled for future bounded single-frame review only.",
        blockers: gateBlockers,
      },
      {
        stage: "continuity_state_preparation",
        simulated: true,
        ready: continuityReady,
        detail: "Continuity-state preparation keeps sequence evidence explicit before any future frame work.",
        blockers: continuityReady ? [] : ["Continuity readiness remains below governed warmup threshold."],
      },
      {
        stage: "vram_staging_assumptions",
        simulated: true,
        ready: input.futureInferenceActivation.dry_vram_reservation,
        detail: "VRAM staging assumptions remain dry bookkeeping only.",
        blockers: input.futureInferenceActivation.dry_vram_reservation ? [] : ["Dry VRAM reservation scaffold is missing."],
      },
      {
        stage: "dry_execution_sequencing",
        simulated: true,
        ready: input.gateValidation.valid,
        detail: "Dry execution sequencing stays gated and cannot cross into inference execution.",
        blockers: gateBlockers,
      },
    ],
    next_unlock_condition: "Frame-stage readiness must pass before any future reviewed warmup bridge is considered.",
    vram_assumptions: uniqueNormalizedStrings([
      ...input.loaderRegistry.map((entry) => `${entry.loader_id}: reserve up to ${entry.estimated_vram}GB in dry warmup only.`),
      "VRAM staging assumptions remain modeled only and cannot allocate live resources.",
    ]),
  };
}

function buildSingleFrameExecutionPrecursor(input: {
  gateValidation: CinematicPreInferenceGateValidation;
  frameStageReadiness: CinematicFrameStageReadinessValidation;
}): CinematicSingleFrameExecutionPrecursor {
  const blockers = uniqueNormalizedStrings([
    ...input.gateValidation.checks.filter((entry) => !entry.passed).flatMap((entry) => entry.blockers),
    ...input.frameStageReadiness.checks.filter((entry) => !entry.passed).flatMap((entry) => entry.blockers),
  ]);
  return {
    precursor_set_id: `single-frame-precursor-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    entries: [
      {
        precursor_id: "gated_single_frame_prepare",
        scaffolded: true,
        unlocked: false,
        detail: "Prepare a future single-frame-only reviewed execution bridge without enabling inference.",
        blockers,
      },
      {
        precursor_id: "gated_low_resolution_prepare",
        scaffolded: true,
        unlocked: false,
        detail: "Prepare a future low-resolution bounded review lane while keeping output disabled.",
        blockers,
      },
      {
        precursor_id: "gated_preview_prepare",
        scaffolded: true,
        unlocked: false,
        detail: "Prepare a governed preview path that remains render-disabled in this phase.",
        blockers,
      },
      {
        precursor_id: "gated_temporal_prepare",
        scaffolded: true,
        unlocked: false,
        detail: "Prepare temporal sequencing controls without permitting temporal synthesis.",
        blockers,
      },
      {
        precursor_id: "governed_output_prepare",
        scaffolded: true,
        unlocked: false,
        detail: "Prepare governed output packaging rules with render output still blocked.",
        blockers,
      },
    ],
  };
}

function buildFrameStageReadinessValidation(input: {
  gateValidation: CinematicPreInferenceGateValidation;
  warmup: CinematicDryInferenceWarmup;
  forbiddenExecutionStates: CinematicForbiddenExecutionStateEnforcement;
  activationAuthorityRegistry: CinematicActivationAuthorityRegistryEntry[];
  boundary: CinematicExecutionBoundaryState;
  integrity: CinematicRuntimeIntegrityValidation;
  readiness: CinematicLocalInferenceReadinessReport;
}): CinematicFrameStageReadinessValidation {
  const continuityProgress = input.readiness.milestone_progress.find((entry) => entry.milestone === "continuity-preserving-local-generation")?.percentage ?? 0;
  const schedulerWarmup = input.warmup.stages.find((entry) => entry.stage === "scheduler_warmup");
  const pipelineWarmup = input.warmup.stages.find((entry) => entry.stage === "pipeline_warmup");
  const checks: CinematicFrameStageReadinessCheck[] = [
    {
      check: "scheduler-readiness",
      passed: schedulerWarmup?.ready ?? false,
      detail: "Scheduler warmup simulation must exist before frame-stage readiness can advance.",
      blockers: schedulerWarmup?.blockers ?? ["Scheduler warmup simulation missing."],
    },
    {
      check: "pipeline-binding-readiness",
      passed: pipelineWarmup?.ready ?? false,
      detail: "Pipeline binding readiness must remain dry and recorded before single-frame preparation is considered.",
      blockers: pipelineWarmup?.blockers ?? ["Pipeline warmup simulation missing."],
    },
    {
      check: "continuity-readiness",
      passed: continuityProgress >= 70,
      detail: "Continuity readiness must reach the governed threshold before any frame-stage transition is modeled as ready.",
      blockers: continuityProgress >= 70 ? [] : ["Continuity readiness remains below the frame-stage threshold."],
    },
    {
      check: "execution-boundary-integrity",
      passed: input.boundary.tracked_statuses.includes("inference_disabled") && input.boundary.tracked_statuses.includes("rendering_disabled"),
      detail: "Execution boundary integrity must keep inference and rendering disabled throughout warmup modeling.",
      blockers: input.boundary.activation_blockers,
    },
    {
      check: "authority-approval-state",
      passed: input.activationAuthorityRegistry.length >= 4,
      detail: "Authority approval state must stay explicit for bounded single-frame preparation.",
      blockers: input.activationAuthorityRegistry.length >= 4 ? [] : ["Activation authority coverage is incomplete."],
    },
    {
      check: "forbidden-state-enforcement",
      passed: input.forbiddenExecutionStates.states.every((entry) => entry.blocked),
      detail: "All forbidden execution states must remain explicitly blocked.",
      blockers: input.forbiddenExecutionStates.states.every((entry) => entry.blocked) ? [] : ["A forbidden execution state is no longer blocked."],
    },
    {
      check: "runtime-integrity-sufficiency",
      passed: input.integrity.valid,
      detail: "Runtime integrity sufficiency remains required even for dry warmup and frame-stage planning.",
      blockers: input.integrity.blockers,
    },
  ];
  return {
    validation_id: `frame-stage-readiness-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    valid: checks.every((entry) => entry.passed) && input.gateValidation.valid,
    checks,
    next_unlock_condition: checks.find((entry) => !entry.passed)?.detail ?? input.gateValidation.next_unlock_condition,
  };
}

function buildWarmupEscalationModeling(input: {
  readiness: CinematicLocalInferenceReadinessReport;
  warmup: CinematicDryInferenceWarmup;
  loaderRegistry: CinematicLocalModelLoaderRecord[];
  frameStageReadiness: CinematicFrameStageReadinessValidation;
}): CinematicWarmupEscalationModeling {
  const continuityProgress = input.readiness.milestone_progress.find((entry) => entry.milestone === "continuity-preserving-local-generation")?.percentage ?? 0;
  const offlineMode = input.readiness.recommended_routing_mode === "offline-planning-mode";
  const lowVramBlockers = input.loaderRegistry.filter((entry) => entry.estimated_vram >= 14).map((entry) => `${entry.loader_id} requires ${entry.estimated_vram}GB VRAM.`);
  return {
    escalation_id: `warmup-escalation-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    scenarios: [
      {
        escalation: "warmup-risk-escalation",
        triggered: input.warmup.stages.some((entry) => !entry.ready),
        detail: "Warmup-risk escalation preserves dry-only governance when warmup stages remain blocked.",
        blockers: input.warmup.stages.filter((entry) => !entry.ready).flatMap((entry) => entry.blockers),
      },
      {
        escalation: "low-vram-escalation",
        triggered: lowVramBlockers.length > 0,
        detail: "Low-VRAM escalation keeps future single-frame preparation conservative under tight memory assumptions.",
        blockers: lowVramBlockers,
      },
      {
        escalation: "continuity-risk-escalation",
        triggered: continuityProgress < 70,
        detail: "Continuity-risk escalation blocks frame-stage advancement until continuity evidence improves.",
        blockers: continuityProgress < 70 ? ["Continuity readiness remains below governed threshold."] : [],
      },
      {
        escalation: "offline-escalation",
        triggered: offlineMode,
        detail: "Offline escalation keeps the warmup lane planning-only when runtime integrity or environment evidence is incomplete.",
        blockers: offlineMode ? ["Routing remains in offline-planning-mode."] : [],
      },
      {
        escalation: "hybrid-escalation",
        triggered: input.readiness.recommended_routing_mode === "balanced-comparison-mode",
        detail: "Hybrid escalation keeps local and cloud options advisory while local warmup remains non-executing.",
        blockers: input.readiness.recommended_routing_mode === "balanced-comparison-mode" ? ["Hybrid comparison remains advisory only."] : [],
      },
      {
        escalation: "blocked-warmup-recovery",
        triggered: !input.frameStageReadiness.valid,
        detail: "Blocked warmup recovery models the path back to safe dry preparation instead of execution.",
        blockers: input.frameStageReadiness.checks.filter((entry) => !entry.passed).flatMap((entry) => entry.blockers),
      },
    ],
  };
}

function buildFutureBoundedExecutionRules(input: {
  frameStageReadiness: CinematicFrameStageReadinessValidation;
  executionTemperatureState: CinematicExecutionTemperatureStateRecord;
}): CinematicFutureBoundedExecutionRules {
  const blockers = input.frameStageReadiness.checks.filter((entry) => !entry.passed).flatMap((entry) => entry.blockers);
  return {
    rule_set_id: `future-bounded-execution-rules-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    rules: [
      {
        rule_id: "single-frame-only-execution",
        unlocked: false,
        detail: "Any future execution bridge must begin with a single-frame-only reviewed lane.",
        governance_requirements: ["manual operator approval", "reviewed single-frame bridge"],
        blockers,
      },
      {
        rule_id: "low-resolution-only-execution",
        unlocked: false,
        detail: "Any first bounded output must stay low-resolution-only until stability evidence accumulates.",
        governance_requirements: ["low-resolution governance review", "runtime integrity approval"],
        blockers,
      },
      {
        rule_id: "governed-preview-generation",
        unlocked: false,
        detail: "Preview generation must remain governed and cannot bypass render-output restrictions.",
        governance_requirements: ["preview governance approval", "render-output guardrails"],
        blockers,
      },
      {
        rule_id: "bounded-retry-limits",
        unlocked: false,
        detail: "Any future bounded execution must keep retry counts explicitly limited and reviewed.",
        governance_requirements: ["bounded retry plan", "manual-only escalation"],
        blockers,
      },
      {
        rule_id: "manual-only-escalation",
        unlocked: false,
        detail: "Escalation out of dry warmup must remain manual-only with no autonomous promotion.",
        governance_requirements: ["manual operator approval", "governance escalation record"],
        blockers,
      },
      {
        rule_id: "continuity-safe-execution",
        unlocked: false,
        detail: `Continuity-safe execution can only be considered after execution temperature leaves ${input.executionTemperatureState.current_state} through a reviewed bridge.`,
        governance_requirements: ["continuity review approval", "frame-stage readiness pass"],
        blockers,
      },
    ],
  };
}

function buildDryExecutionTokenRegistry(input: {
  activationAuthorityRegistry: CinematicActivationAuthorityRegistryEntry[];
  frameStageReadiness: CinematicFrameStageReadinessValidation;
  executionTemperatureState: CinematicExecutionTemperatureStateRecord;
  boundary: CinematicExecutionBoundaryState;
}): CinematicDryExecutionTokenRegistryEntry[] {
  const sharedBlockers = input.frameStageReadiness.checks.filter((entry) => !entry.passed).flatMap((entry) => entry.blockers);
  return [
    {
      token_id: "token-single-frame-dry-governed",
      activation_authority: input.activationAuthorityRegistry[0]?.authority_id ?? "authority-manual-operator-gate",
      execution_scope: "dry_single_frame_traversal",
      allowed_stage: "dry_execution_request",
      forbidden_stage: "dry_output_blocked",
      expiration_policy: "expires_after_single_reviewed_dry_traversal",
      governance_requirements: ["manual operator approval", "token review record", "append-only attempt ledger"],
      continuity_requirements: ["continuity-safe sequence evidence", "frame-stage continuity check"],
      escalation_policy: ["manual-only escalation", "runtime-risk escalation remains blocking"],
      execution_boundary_requirements: input.boundary.tracked_statuses,
      execution_restrictions: ["simulation_only", `temperature=${input.executionTemperatureState.current_state}`],
      forbidden_operations: ["inference_execute", "frame_generate", "renderer_activate", "output_images_video"],
      continuity_restrictions: ["no continuity-state mutation", ...sharedBlockers],
      escalation_restrictions: ["no autonomous escalation", "no unattended retry loops"],
    },
    {
      token_id: "token-preview-dry-governed",
      activation_authority: input.activationAuthorityRegistry[3]?.authority_id ?? "authority-render-output-governor",
      execution_scope: "dry_preview_traversal",
      allowed_stage: "dry_packaging_stage",
      forbidden_stage: "dry_output_blocked",
      expiration_policy: "expires_when_packaging_review_finishes_without_output_unlock",
      governance_requirements: ["preview governance approval", "non-rendering confirmation"],
      continuity_requirements: ["continuity-safe packaging notes"],
      escalation_policy: ["bounded preview escalation only", "manual-only escalation"],
      execution_boundary_requirements: ["rendering_disabled", "execution_blocked"],
      execution_restrictions: ["no live packaging", "no renderer output"],
      forbidden_operations: ["renderer_activate", "temporal_render", "output_images_video"],
      continuity_restrictions: ["preserve continuity state as read-only"],
      escalation_restrictions: ["no preview auto-promotion"],
    },
  ];
}

function buildSingleFrameDryExecutionPath(input: {
  tokenRegistry: CinematicDryExecutionTokenRegistryEntry[];
  frameTraversalValidation: CinematicFrameTraversalValidation | null;
}): CinematicSingleFrameDryExecutionPath {
  const validationBlockers = input.frameTraversalValidation?.blocked_transitions ?? [];
  const pathStages: CinematicDryExecutionTraversalStage[] = [
    "dry_execution_request",
    "dry_scheduler_stage",
    "dry_pipeline_stage",
    "dry_frame_stage",
    "dry_packaging_stage",
    "dry_output_blocked",
    "dry_execution_archived",
  ];
  const firstToken = input.tokenRegistry[0];
  return {
    path_id: `single-frame-dry-path-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    stages: pathStages.map((stage, index) => ({
      stage,
      order: index + 1,
      simulated: true,
      status: stage === "dry_execution_request"
        ? "ready"
        : stage === "dry_execution_archived"
          ? "archived"
          : "blocked",
      detail: stage === "dry_execution_request"
        ? `Token ${firstToken?.token_id ?? "none"} authorizes a dry request only.`
        : stage === "dry_output_blocked"
          ? "Dry output remains blocked to preserve non-rendering boundaries."
          : stage === "dry_execution_archived"
            ? "The dry execution attempt is archived append-only without output generation."
            : `Stage ${stage} remains simulated-only pending validated dry traversal gates.`,
      blockers: stage === "dry_execution_request" ? [] : validationBlockers,
    })),
    next_stage: "dry_execution_request",
  };
}

function buildFrameTraversalValidation(input: {
  tokenRegistry: CinematicDryExecutionTokenRegistryEntry[];
  activationAuthorityRegistry: CinematicActivationAuthorityRegistryEntry[];
  boundary: CinematicExecutionBoundaryState;
  forbiddenExecutionStates: CinematicForbiddenExecutionStateEnforcement;
  readiness: CinematicLocalInferenceReadinessReport;
  integrity: CinematicRuntimeIntegrityValidation;
  warmupEscalationModeling: CinematicWarmupEscalationModeling;
}): CinematicFrameTraversalValidation {
  const continuityProgress = input.readiness.milestone_progress.find((entry) => entry.milestone === "continuity-preserving-local-generation")?.percentage ?? 0;
  const tokenAuthorities = new Set(input.tokenRegistry.map((entry) => entry.activation_authority));
  const checks: CinematicFrameTraversalValidationCheck[] = [
    {
      check: "execution-token-validity",
      passed: input.tokenRegistry.length > 0,
      detail: "A dry execution token must exist before bounded traversal is modeled.",
      blockers: input.tokenRegistry.length > 0 ? [] : ["No dry execution token is registered."],
    },
    {
      check: "authority-compatibility",
      passed: input.activationAuthorityRegistry.some((entry) => tokenAuthorities.has(entry.authority_id)),
      detail: "Execution token authority must match a known activation authority.",
      blockers: input.activationAuthorityRegistry.some((entry) => tokenAuthorities.has(entry.authority_id)) ? [] : ["Dry execution token authority is not recognized."],
    },
    {
      check: "execution-boundary-integrity",
      passed: input.boundary.tracked_statuses.includes("inference_disabled") && input.boundary.tracked_statuses.includes("rendering_disabled"),
      detail: "Execution boundary integrity must keep inference and rendering disabled throughout dry traversal.",
      blockers: input.boundary.activation_blockers,
    },
    {
      check: "forbidden-state-enforcement",
      passed: input.forbiddenExecutionStates.states.every((entry) => entry.blocked),
      detail: "Forbidden-state enforcement must remain intact before any dry path stage can advance.",
      blockers: input.forbiddenExecutionStates.states.every((entry) => entry.blocked) ? [] : ["A forbidden execution state is not blocked."],
    },
    {
      check: "continuity-state-readiness",
      passed: continuityProgress >= 70,
      detail: "Continuity state must meet the governed readiness threshold before dry frame traversal is considered safe.",
      blockers: continuityProgress >= 70 ? [] : ["Continuity state readiness remains below threshold."],
    },
    {
      check: "runtime-integrity-sufficiency",
      passed: input.integrity.valid,
      detail: "Runtime integrity remains a hard blocker even for dry execution traversal.",
      blockers: input.integrity.blockers,
    },
    {
      check: "escalation-compliance",
      passed: input.warmupEscalationModeling.scenarios.every((entry) => entry.escalation !== "blocked-warmup-recovery" || entry.triggered),
      detail: "Escalation compliance requires dry recovery handling to remain modeled when traversal is blocked.",
      blockers: input.warmupEscalationModeling.scenarios.filter((entry) => entry.triggered).flatMap((entry) => entry.blockers),
    },
  ];
  return {
    validation_id: `frame-traversal-validation-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    valid: checks.every((entry) => entry.passed),
    checks,
    blocked_transitions: checks.filter((entry) => !entry.passed).map((entry) => entry.check),
    next_unlock_condition: checks.find((entry) => !entry.passed)?.detail ?? "Traversal validation is satisfied, but synthesis remains hard-gated.",
  };
}

function buildDryExecutionRecoveryModeling(input: {
  tokenRegistry: CinematicDryExecutionTokenRegistryEntry[];
  traversalValidation: CinematicFrameTraversalValidation;
  readiness: CinematicLocalInferenceReadinessReport;
  loaderRegistry: CinematicLocalModelLoaderRecord[];
  governanceEscalationModeling: CinematicGovernanceEscalationModeling;
}): CinematicDryExecutionRecoveryModeling {
  const continuityProgress = input.readiness.milestone_progress.find((entry) => entry.milestone === "continuity-preserving-local-generation")?.percentage ?? 0;
  const lowVramBlockers = input.loaderRegistry.filter((entry) => entry.estimated_vram >= 14).map((entry) => `${entry.loader_id} requires ${entry.estimated_vram}GB VRAM.`);
  return {
    recovery_id: `dry-execution-recovery-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    scenarios: [
      {
        recovery: "token-expiration-recovery",
        triggered: input.tokenRegistry.some((entry) => /expires/i.test(entry.expiration_policy)),
        detail: "Expired dry execution tokens require a new reviewed token rather than automatic renewal.",
        blockers: input.tokenRegistry.map((entry) => `${entry.token_id}: ${entry.expiration_policy}`),
      },
      {
        recovery: "blocked-stage-recovery",
        triggered: !input.traversalValidation.valid,
        detail: "Blocked traversal stages recover by returning to dry request review instead of execution.",
        blockers: input.traversalValidation.blocked_transitions,
      },
      {
        recovery: "continuity-recovery",
        triggered: continuityProgress < 70,
        detail: "Continuity recovery restores read-only continuity evidence before any further dry traversal attempt.",
        blockers: continuityProgress < 70 ? ["Continuity state readiness remains below threshold."] : [],
      },
      {
        recovery: "low-vram-recovery",
        triggered: lowVramBlockers.length > 0,
        detail: "Low-VRAM recovery reduces traversal ambition rather than permitting live execution.",
        blockers: lowVramBlockers,
      },
      {
        recovery: "governance-escalation-recovery",
        triggered: input.governanceEscalationModeling.scenarios.some((entry) => entry.triggered),
        detail: "Governance escalation recovery routes back through manual review and append-only records.",
        blockers: input.governanceEscalationModeling.scenarios.filter((entry) => entry.triggered).map((entry) => entry.escalation),
      },
      {
        recovery: "dry-rollback-sequencing",
        triggered: true,
        detail: "Dry rollback sequencing archives the attempt and preserves non-rendering boundaries after any blocked traversal.",
        blockers: input.traversalValidation.blocked_transitions,
      },
    ],
  };
}

function buildFutureFrameSynthesisUnlocks(input: {
  traversalValidation: CinematicFrameTraversalValidation;
  tokenRegistry: CinematicDryExecutionTokenRegistryEntry[];
}): CinematicFutureFrameSynthesisUnlocks {
  const blocked = input.traversalValidation.checks.filter((entry) => !entry.passed).flatMap((entry) => entry.blockers);
  const milestone = "reviewed-real-frame-synthesis-bridge";
  const stillForbidden = uniqueNormalizedStrings(input.tokenRegistry.flatMap((entry) => entry.forbidden_operations));
  return {
    unlock_set_id: `future-frame-synthesis-unlocks-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    milestone_unlocks_real_synthesis: milestone,
    unlocks: [
      {
        unlock_id: "governed-single-frame-synthesis",
        unlocked: false,
        prerequisites: uniqueNormalizedStrings(["validated dry traversal", ...blocked]),
        still_forbidden_operations: stillForbidden,
        unlocks_real_synthesis_at: milestone,
      },
      {
        unlock_id: "low-resolution-synthesis",
        unlocked: false,
        prerequisites: ["low-resolution governance approval", "runtime integrity approval"],
        still_forbidden_operations: stillForbidden,
        unlocks_real_synthesis_at: milestone,
      },
      {
        unlock_id: "governed-preview-generation",
        unlocked: false,
        prerequisites: ["preview governance approval", "dry packaging review"],
        still_forbidden_operations: stillForbidden,
        unlocks_real_synthesis_at: milestone,
      },
      {
        unlock_id: "bounded-renderer-output",
        unlocked: false,
        prerequisites: ["bounded renderer review", "non-rendering guard relaxation review"],
        still_forbidden_operations: stillForbidden,
        unlocks_real_synthesis_at: milestone,
      },
      {
        unlock_id: "continuity-safe-synthesis",
        unlocked: false,
        prerequisites: ["continuity-safe synthesis approval", "continuity evidence preserved"],
        still_forbidden_operations: stillForbidden,
        unlocks_real_synthesis_at: milestone,
      },
      {
        unlock_id: "temporal-preview-sequencing",
        unlocked: false,
        prerequisites: ["temporal preview review", "single-frame dry traversal stability"],
        still_forbidden_operations: stillForbidden,
        unlocks_real_synthesis_at: milestone,
      },
    ],
  };
}

function buildExecutionAttemptLedger(input: {
  tokenRegistry: CinematicDryExecutionTokenRegistryEntry[];
  dryExecutionPath: CinematicSingleFrameDryExecutionPath;
  traversalValidation: CinematicFrameTraversalValidation;
  recovery: CinematicDryExecutionRecoveryModeling;
  executionTemperatureState: CinematicExecutionTemperatureStateRecord;
}): CinematicExecutionAttemptLedger {
  const token = input.tokenRegistry[0];
  return {
    ledger_id: `execution-attempt-ledger-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    attempts: [
      {
        attempt_id: `dry-attempt-${Date.now()}`,
        recorded_at: new Date().toISOString(),
        token_id: token?.token_id ?? "no-token",
        dry_execution_attempt: input.dryExecutionPath.stages.map((entry) => entry.stage).join(" -> "),
        blocked_transitions: input.traversalValidation.blocked_transitions,
        escalation_triggers: input.recovery.scenarios.filter((entry) => entry.triggered).map((entry) => entry.recovery),
        rollback_reasons: input.recovery.scenarios.filter((entry) => entry.recovery === "dry-rollback-sequencing").flatMap((entry) => entry.blockers),
        authority_approvals: input.tokenRegistry.flatMap((entry) => entry.governance_requirements),
        execution_temperature_changes: input.executionTemperatureState.transitions.map((entry) => `${entry.state}:${entry.transition_reason}`),
      },
    ],
  };
}

function buildSynthesisContainmentRegistry(input: {
  tokenRegistry: CinematicDryExecutionTokenRegistryEntry[];
  activationAuthorityRegistry: CinematicActivationAuthorityRegistryEntry[];
  executionTemperatureState: CinematicExecutionTemperatureStateRecord;
  boundary: CinematicExecutionBoundaryState;
}): CinematicSynthesisContainmentRegistryEntry[] {
  const rollbackAuthority = input.activationAuthorityRegistry[0]?.authority_id ?? "authority-manual-operator-gate";
  const escalationAuthority = input.activationAuthorityRegistry[2]?.authority_id ?? "authority-runtime-integrity-review";
  return [
    {
      containment_id: "containment-governed-single-frame-prepare",
      synthesis_scope: "governed_single_frame_preparation",
      allowed_resolution: "720p",
      maximum_resolution: "720p",
      allowed_frame_count: 1,
      maximum_frame_count: 1,
      output_permissions: ["simulation_only", "no_output_emission"],
      output_restrictions: ["renderer_disabled", "preview_disabled", "image_video_output_blocked"],
      rollback_authority: rollbackAuthority,
      escalation_authority: escalationAuthority,
      forbidden_synthesis_states: ["image_generate", "video_generate", "renderer_activate", "preview_output", "temporal_synthesis"],
      continuity_constraints: ["continuity state remains read-only", "single-frame preparation must preserve sequence evidence"],
      governance_constraints: [
        "manual containment approval required",
        `temperature=${input.executionTemperatureState.current_state}`,
        ...input.boundary.tracked_statuses,
      ],
      containment_expiration: "expires_after_reviewed_single_frame_synthesis_preparation",
    },
    {
      containment_id: "containment-governed-preview-prepare",
      synthesis_scope: "preview_frame_preparation",
      allowed_resolution: "720p",
      maximum_resolution: "720p",
      allowed_frame_count: 1,
      maximum_frame_count: 1,
      output_permissions: ["simulation_only", "governed_preview_scaffold_only"],
      output_restrictions: ["no_preview_render", "no_renderer_unlock", "blocked_output_persistence"],
      rollback_authority: rollbackAuthority,
      escalation_authority: escalationAuthority,
      forbidden_synthesis_states: ["preview_render", "renderer_preview_activate", "output_images_video"],
      continuity_constraints: ["preview preparation cannot mutate continuity records"],
      governance_constraints: ["preview mode remains hard-gated", `token_count=${input.tokenRegistry.length}`],
      containment_expiration: "expires_when_preview_preparation_review_closes_without_output_unlock",
    },
  ];
}

function buildGovernedSynthesisPreparationPath(input: {
  containmentRegistry: CinematicSynthesisContainmentRegistryEntry[];
  synthesisValidationLayer: CinematicSynthesisValidationLayer | null;
}): CinematicGovernedSynthesisPreparationPath {
  const validationBlockers = input.synthesisValidationLayer?.blocked_transitions ?? [];
  const stages: CinematicGovernedSynthesisPreparationStage[] = [
    "synthesis_prepare_request",
    "synthesis_scheduler_prepare",
    "synthesis_pipeline_prepare",
    "synthesis_frame_prepare",
    "synthesis_output_blocked",
    "synthesis_prepare_archived",
  ];
  const containment = input.containmentRegistry[0] ?? null;
  return {
    preparation_id: `governed-synthesis-preparation-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    containment_id: containment?.containment_id ?? null,
    stages: stages.map((stage, index) => ({
      stage,
      order: index + 1,
      simulated: true,
      status: stage === "synthesis_prepare_request"
        ? "ready"
        : stage === "synthesis_prepare_archived"
          ? "archived"
          : "blocked",
      detail: stage === "synthesis_prepare_request"
        ? `Containment ${containment?.containment_id ?? "none"} authorizes preparation modeling only.`
        : stage === "synthesis_output_blocked"
          ? "Synthesis output remains blocked to preserve strict non-rendering boundaries."
          : stage === "synthesis_prepare_archived"
            ? "The governed synthesis preparation is archived append-only without renderer output."
            : `Stage ${stage} remains simulated-only until every synthesis containment gate is satisfied.`,
      blockers: stage === "synthesis_prepare_request" ? [] : validationBlockers,
    })),
    next_stage: "synthesis_prepare_request",
  };
}

function buildSynthesisValidationLayer(input: {
  containmentRegistry: CinematicSynthesisContainmentRegistryEntry[];
  tokenRegistry: CinematicDryExecutionTokenRegistryEntry[];
  readiness: CinematicLocalInferenceReadinessReport;
  preInferenceGateValidation: CinematicPreInferenceGateValidation;
  forbiddenExecutionStates: CinematicForbiddenExecutionStateEnforcement;
  runtimeIntegrityValidation: CinematicRuntimeIntegrityValidation;
  containedAuthorities: CinematicActivationAuthorityRegistryEntry[];
  dryExecutionRecovery: CinematicDryExecutionRecoveryModeling;
}): CinematicSynthesisValidationLayer {
  const continuityProgress = input.readiness.milestone_progress.find((entry) => entry.milestone === "continuity-preserving-local-generation")?.percentage ?? 0;
  const knownAuthorities = new Set(input.containedAuthorities.map((entry) => entry.authority_id));
  const outputBlocked = input.containmentRegistry.every((entry) => entry.output_restrictions.some((restriction) => /block|disabled/i.test(restriction)));
  const checks: CinematicSynthesisValidationCheck[] = [
    {
      check: "synthesis-containment-validity",
      passed: input.containmentRegistry.length > 0 && input.containmentRegistry.every((entry) => entry.maximum_frame_count <= 1),
      detail: "Synthesis containment must exist and remain bounded to a single governed frame preparation.",
      blockers: input.containmentRegistry.length > 0 && input.containmentRegistry.every((entry) => entry.maximum_frame_count <= 1)
        ? []
        : ["Synthesis containment is missing or exceeds the single-frame preparation bound."],
    },
    {
      check: "execution-token-compatibility",
      passed: input.tokenRegistry.length > 0 && input.containmentRegistry.every((entry) => knownAuthorities.has(entry.rollback_authority) && knownAuthorities.has(entry.escalation_authority)),
      detail: "Containment rollback and escalation authorities must remain compatible with the governed execution token path.",
      blockers: input.tokenRegistry.length > 0 && input.containmentRegistry.every((entry) => knownAuthorities.has(entry.rollback_authority) && knownAuthorities.has(entry.escalation_authority))
        ? []
        : ["Containment authorities are not compatible with the governed token path."],
    },
    {
      check: "continuity-state-readiness",
      passed: continuityProgress >= 70,
      detail: "Continuity readiness must stay above threshold before synthesis preparation is considered safe.",
      blockers: continuityProgress >= 70 ? [] : ["Continuity state readiness remains below governed synthesis threshold."],
    },
    {
      check: "governance-approval-state",
      passed: input.preInferenceGateValidation.checks.find((entry) => entry.gate === "manual-governance-review")?.passed ?? false,
      detail: "Governance approval state must remain manually reviewed before synthesis preparation advances.",
      blockers: input.preInferenceGateValidation.checks.find((entry) => entry.gate === "manual-governance-review")?.blockers ?? ["Manual governance review is not satisfied."],
    },
    {
      check: "forbidden-state-enforcement",
      passed: input.forbiddenExecutionStates.states.every((entry) => entry.blocked),
      detail: "Forbidden-state enforcement must continue blocking inference, generation, and renderer output.",
      blockers: input.forbiddenExecutionStates.states.every((entry) => entry.blocked) ? [] : ["A forbidden synthesis state is not blocked."],
    },
    {
      check: "runtime-integrity-sufficiency",
      passed: input.runtimeIntegrityValidation.valid,
      detail: "Runtime integrity remains a hard blocker even for synthesis preparation modeling.",
      blockers: input.runtimeIntegrityValidation.blockers,
    },
    {
      check: "escalation-compliance",
      passed: input.dryExecutionRecovery.scenarios.some((entry) => entry.recovery === "dry-rollback-sequencing" && entry.triggered),
      detail: "Escalation compliance requires rollback and recovery governance to remain modeled.",
      blockers: input.dryExecutionRecovery.scenarios.filter((entry) => entry.triggered).flatMap((entry) => entry.blockers),
    },
    {
      check: "output-block-enforcement",
      passed: outputBlocked,
      detail: "Output blocking must stay explicit in every synthesis containment record.",
      blockers: outputBlocked ? [] : ["One or more synthesis containment records do not explicitly block output."],
    },
  ];
  return {
    validation_id: `synthesis-validation-layer-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    valid: checks.every((entry) => entry.passed),
    checks,
    blocked_transitions: checks.filter((entry) => !entry.passed).map((entry) => entry.check),
    next_unlock_condition: checks.find((entry) => !entry.passed)?.detail ?? "Synthesis preparation remains validated, but real synthesis stays hard-gated.",
  };
}

function buildContainedEscalationModeling(input: {
  containmentRegistry: CinematicSynthesisContainmentRegistryEntry[];
  synthesisValidationLayer: CinematicSynthesisValidationLayer;
  readiness: CinematicLocalInferenceReadinessReport;
  runtimeIntegrityValidation: CinematicRuntimeIntegrityValidation;
  governedPreparation: CinematicGovernedSynthesisPreparationPath;
}): CinematicContainedEscalationModeling {
  const continuityProgress = input.readiness.milestone_progress.find((entry) => entry.milestone === "continuity-preserving-local-generation")?.percentage ?? 0;
  const outputBlocked = input.containmentRegistry.some((entry) => entry.output_restrictions.some((restriction) => /block/i.test(restriction)));
  return {
    escalation_id: `contained-escalation-modeling-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    scenarios: [
      {
        escalation: "low-resolution-escalation",
        triggered: input.containmentRegistry.some((entry) => entry.maximum_resolution === "720p"),
        detail: "Low-resolution escalation keeps future output scaffolding bounded to governed 720p preparation.",
        blockers: input.containmentRegistry.map((entry) => `${entry.containment_id}: max=${entry.maximum_resolution}`),
      },
      {
        escalation: "continuity-risk-escalation",
        triggered: continuityProgress < 70,
        detail: "Continuity risk escalation returns synthesis preparation to manual review when continuity evidence is weak.",
        blockers: continuityProgress < 70 ? ["Continuity state readiness remains below threshold."] : [],
      },
      {
        escalation: "blocked-output-escalation",
        triggered: outputBlocked,
        detail: "Blocked-output escalation preserves non-rendering boundaries instead of allowing preview output.",
        blockers: outputBlocked ? ["Output remains intentionally blocked by containment policy."] : [],
      },
      {
        escalation: "rollback-escalation",
        triggered: input.synthesisValidationLayer.blocked_transitions.length > 0,
        detail: "Rollback escalation archives the preparation attempt and returns authority to governed rollback review.",
        blockers: input.synthesisValidationLayer.blocked_transitions,
      },
      {
        escalation: "containment-expiration-recovery",
        triggered: input.containmentRegistry.some((entry) => /expires/i.test(entry.containment_expiration)),
        detail: "Containment expiration requires renewed manual approval instead of automatic carry-forward.",
        blockers: input.containmentRegistry.map((entry) => `${entry.containment_id}: ${entry.containment_expiration}`),
      },
      {
        escalation: "bounded-retry-escalation",
        triggered: !input.runtimeIntegrityValidation.valid || input.governedPreparation.stages.some((entry) => entry.status === "blocked"),
        detail: "Bounded retry escalation keeps retries manual, append-only, and non-rendering.",
        blockers: uniqueNormalizedStrings([
          ...input.runtimeIntegrityValidation.blockers,
          ...input.governedPreparation.stages.filter((entry) => entry.status === "blocked").map((entry) => entry.stage),
        ]),
      },
    ],
  };
}

function buildFutureLowResolutionOutputScaffolding(input: {
  containmentRegistry: CinematicSynthesisContainmentRegistryEntry[];
  synthesisValidationLayer: CinematicSynthesisValidationLayer;
}): CinematicFutureLowResolutionOutputScaffolding {
  const stillForbidden = uniqueNormalizedStrings(input.containmentRegistry.flatMap((entry) => [
    ...entry.forbidden_synthesis_states,
    ...entry.output_restrictions,
  ]));
  const prerequisiteBlockers = uniqueNormalizedStrings(input.synthesisValidationLayer.checks.filter((entry) => !entry.passed).flatMap((entry) => entry.blockers));
  const milestone = "reviewed-governed-low-resolution-output-bridge";
  return {
    scaffold_id: `future-low-resolution-output-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    milestone_unlocks_governed_output: milestone,
    outputs: [
      {
        output_id: "governed-thumbnail-synthesis",
        unlocked: false,
        prerequisites: uniqueNormalizedStrings(["thumbnail governance approval", ...prerequisiteBlockers]),
        still_forbidden_operations: stillForbidden,
        target_resolution: "720p",
      },
      {
        output_id: "governed-preview-frame-synthesis",
        unlocked: false,
        prerequisites: uniqueNormalizedStrings(["preview frame containment approval", ...prerequisiteBlockers]),
        still_forbidden_operations: stillForbidden,
        target_resolution: "720p",
      },
      {
        output_id: "bounded-low-resolution-output",
        unlocked: false,
        prerequisites: ["bounded output review", "manual rollback coverage"],
        still_forbidden_operations: stillForbidden,
        target_resolution: "720p",
      },
      {
        output_id: "continuity-safe-preview-rendering",
        unlocked: false,
        prerequisites: ["continuity-safe preview review", "sequence continuity evidence preserved"],
        still_forbidden_operations: stillForbidden,
        target_resolution: "720p",
      },
      {
        output_id: "governed-renderer-preview-mode",
        unlocked: false,
        prerequisites: ["renderer preview governance review", "blocked output enforcement remains provable"],
        still_forbidden_operations: stillForbidden,
        target_resolution: "720p",
      },
    ],
  };
}

function buildGovernedRollbackLedger(input: {
  containmentRegistry: CinematicSynthesisContainmentRegistryEntry[];
  governedPreparation: CinematicGovernedSynthesisPreparationPath;
  synthesisValidationLayer: CinematicSynthesisValidationLayer;
  containedEscalationModeling: CinematicContainedEscalationModeling;
  executionTemperatureState: CinematicExecutionTemperatureStateRecord;
}): CinematicGovernedRollbackLedger {
  const containment = input.containmentRegistry[0];
  return {
    ledger_id: `governed-rollback-ledger-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    entries: [
      {
        entry_id: `governed-rollback-entry-${Date.now()}`,
        recorded_at: new Date().toISOString(),
        containment_id: containment?.containment_id ?? "no-containment",
        synthesis_preparation_attempt: input.governedPreparation.stages.map((entry) => entry.stage).join(" -> "),
        rollback_events: ["synthesis_prepare_archived", "rollback_authority_review_required"],
        blocked_output_attempts: input.governedPreparation.stages.filter((entry) => entry.stage === "synthesis_output_blocked").map((entry) => entry.detail),
        containment_violations: input.synthesisValidationLayer.blocked_transitions,
        escalation_triggers: input.containedEscalationModeling.scenarios.filter((entry) => entry.triggered).map((entry) => entry.escalation),
        rollback_authority_actions: input.containmentRegistry.map((entry) => `${entry.rollback_authority}: archive_preparation_only`),
        execution_temperature_transitions: input.executionTemperatureState.transitions.map((entry) => `${entry.state}:${entry.transition_reason}`),
      },
    ],
  };
}

function buildRealOutputAuthorizationRegistry(input: {
  activationAuthorityRegistry: CinematicActivationAuthorityRegistryEntry[];
  executionTemperatureState: CinematicExecutionTemperatureStateRecord;
  preInferenceGateValidation: CinematicPreInferenceGateValidation;
}): CinematicRealOutputAuthorizationRegistryEntry[] {
  const rollbackAuthority = input.activationAuthorityRegistry[0]?.authority_id ?? "authority-manual-operator-gate";
  const shutdownAuthority = input.activationAuthorityRegistry[2]?.authority_id ?? "authority-runtime-integrity-review";
  const governanceBlockers = input.preInferenceGateValidation.checks.filter((entry) => !entry.passed).flatMap((entry) => entry.blockers);
  return [
    {
      authorization_id: "authorization-governed-low-res-single-frame",
      synthesis_scope: "governed_low_resolution_single_frame",
      authorized_output_scope: "governed_preview_frame_output",
      allowed_resolution: "720p",
      maximum_resolution: "720p",
      allowed_frame_count: 1,
      maximum_frame_count: 1,
      allowed_output_targets: [GOVERNED_LOW_RES_SANDBOX_DIR],
      output_retention_policy: "retain_latest_single_frame_only",
      rollback_authority: rollbackAuthority,
      shutdown_authority: shutdownAuthority,
      emergency_shutdown_authority: shutdownAuthority,
      continuity_constraints: ["continuity state remains read-only", "single preview frame cannot mutate sequence state"],
      governance_constraints: uniqueNormalizedStrings([
        "manual operator approval required",
        "bounded retry limit: 1",
        `temperature=${input.executionTemperatureState.current_state}`,
        ...governanceBlockers,
      ]),
      authorization_expiration: "expires_after_single_governed_output_execution",
      forbidden_output_behaviors: [
        "video_generation",
        "multi_frame_generation",
        "temporal_generation",
        "autonomous_retries",
        "unsandboxed_output_write",
        "renderer_escalation",
      ],
    },
  ];
}

function buildOutputContainmentValidation(input: {
  authorizationRegistry: CinematicRealOutputAuthorizationRegistryEntry[];
  readiness: CinematicLocalInferenceReadinessReport;
  bootstrap: CinematicDryRuntimeBootstrapValidation;
  forbiddenExecutionStates: CinematicForbiddenExecutionStateEnforcement;
  preInferenceGateValidation: CinematicPreInferenceGateValidation;
}): CinematicOutputContainmentValidation {
  const continuityProgress = input.readiness.milestone_progress.find((entry) => entry.milestone === "continuity-preserving-local-generation")?.percentage ?? 0;
  const auth = input.authorizationRegistry[0] ?? null;
  const outputTargetsSafe = input.authorizationRegistry.every((entry) => entry.allowed_output_targets.every((target) => !target.includes("..") && normalizeText(target).length > 0));
  const manualAuthorizationPresent = input.authorizationRegistry.every((entry) => entry.governance_constraints.some((constraint) => /manual operator approval/i.test(constraint)));
  const checks: CinematicOutputContainmentValidationCheck[] = [
    {
      check: "authorization-validity",
      passed: input.authorizationRegistry.length > 0 && input.authorizationRegistry.every((entry) => /expires/i.test(entry.authorization_expiration)),
      detail: "Real output authorization must exist and remain explicitly expiring.",
      blockers: input.authorizationRegistry.length > 0 && input.authorizationRegistry.every((entry) => /expires/i.test(entry.authorization_expiration))
        ? []
        : ["Real output authorization is missing or non-expiring."],
    },
    {
      check: "resolution-restrictions",
      passed: input.authorizationRegistry.every((entry) => entry.maximum_resolution === "720p"),
      detail: "Real output remains limited to low resolution only.",
      blockers: input.authorizationRegistry.every((entry) => entry.maximum_resolution === "720p") ? [] : ["Output authorization exceeds the low-resolution bound."],
    },
    {
      check: "frame-count-restrictions",
      passed: input.authorizationRegistry.every((entry) => entry.maximum_frame_count === 1),
      detail: "Real output remains limited to a single frame per execution.",
      blockers: input.authorizationRegistry.every((entry) => entry.maximum_frame_count === 1) ? [] : ["Output authorization exceeds the single-frame bound."],
    },
    {
      check: "continuity-state-integrity",
      passed: continuityProgress >= 70,
      detail: "Continuity integrity must remain above threshold before a real preview frame is authorized.",
      blockers: continuityProgress >= 70 ? [] : ["Continuity state integrity remains below threshold."],
    },
    {
      check: "rollback-availability",
      passed: Boolean(auth?.rollback_authority) && input.authorizationRegistry.every((entry) => entry.allowed_output_targets.length > 0),
      detail: "Rollback authority and bounded output targets must exist before real output is written.",
      blockers: Boolean(auth?.rollback_authority) && input.authorizationRegistry.every((entry) => entry.allowed_output_targets.length > 0) ? [] : ["Rollback authority or bounded output target is missing."],
    },
    {
      check: "runtime-integrity-sufficiency",
      passed: input.bootstrap.valid,
      detail: "The bounded low-resolution sandbox requires a valid bootstrap even when full inference integrity remains separately gated.",
      blockers: input.bootstrap.valid ? [] : input.bootstrap.activation_blockers,
    },
    {
      check: "forbidden-state-enforcement",
      passed: input.forbiddenExecutionStates.states.every((entry) => entry.blocked),
      detail: "Forbidden-state enforcement must continue blocking unsafe synthesis behaviors.",
      blockers: input.forbiddenExecutionStates.states.every((entry) => entry.blocked) ? [] : ["A forbidden output behavior is not blocked."],
    },
    {
      check: "output-target-safety",
      passed: outputTargetsSafe && manualAuthorizationPresent,
      detail: "Output targets must stay sandboxed and manually governed.",
      blockers: outputTargetsSafe && manualAuthorizationPresent
        ? []
        : ["Sandbox output target safety or manual governance approval is not satisfied."],
    },
  ];
  return {
    validation_id: `output-containment-validation-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    valid: checks.every((entry) => entry.passed),
    checks,
    blocked_transitions: checks.filter((entry) => !entry.passed).map((entry) => entry.check),
    next_unlock_condition: checks.find((entry) => !entry.passed)?.detail ?? "Bounded real output is authorized for one governed low-resolution frame only.",
  };
}

function buildDeterministicGovernedPreviewFrame(): string {
  const width = 16;
  const height = 16;
  const rows = ["P3", "# AI-E governed low-resolution preview frame", `${width} ${height}`, "255"];
  for (let y = 0; y < height; y += 1) {
    const pixels: string[] = [];
    for (let x = 0; x < width; x += 1) {
      const red = (x * 17) % 256;
      const green = (y * 29) % 256;
      const blue = ((x + y) * 11) % 256;
      pixels.push(`${red} ${green} ${blue}`);
    }
    rows.push(pixels.join(" "));
  }
  return `${rows.join("\n")}\n`;
}

async function executeGovernedLowResolutionSandbox(input: {
  root: string;
  authorizationRegistry: CinematicRealOutputAuthorizationRegistryEntry[];
  outputContainmentValidation: CinematicOutputContainmentValidation;
}): Promise<CinematicGovernedLowResolutionSandbox> {
  const authorization = input.authorizationRegistry[0] ?? null;
  const outputRoot = path.join(input.root, GOVERNED_LOW_RES_SANDBOX_DIR);
  await mkdir(outputRoot, { recursive: true });
  const outputFilePath = path.join(outputRoot, "governed_preview_frame.ppm");
  const deletedOutputTargets: string[] = [];
  for (const entry of await readdir(outputRoot)) {
    const childPath = path.join(outputRoot, entry);
    if (childPath !== outputFilePath) {
      await rm(childPath, { recursive: true, force: true });
      deletedOutputTargets.push(path.relative(input.root, childPath).replace(/\\/g, "/"));
    }
  }
  let realOutputWritten = false;
  if (input.outputContainmentValidation.valid) {
    await writeFile(outputFilePath, buildDeterministicGovernedPreviewFrame(), "utf8");
    realOutputWritten = true;
  } else if (existsSync(outputFilePath)) {
    await rm(outputFilePath, { force: true });
    deletedOutputTargets.push(path.relative(input.root, outputFilePath).replace(/\\/g, "/"));
  }
  return {
    sandbox_id: `governed-low-resolution-sandbox-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    authorization_id: authorization?.authorization_id ?? null,
    output_root: GOVERNED_LOW_RES_SANDBOX_DIR.replace(/\\/g, "/"),
    output_target: authorization?.allowed_output_targets[0] ?? GOVERNED_LOW_RES_SANDBOX_DIR.replace(/\\/g, "/"),
    output_file_path: realOutputWritten ? path.relative(input.root, outputFilePath).replace(/\\/g, "/") : null,
    output_retention_policy: authorization?.output_retention_policy ?? "retain_latest_single_frame_only",
    maximum_resolution: authorization?.maximum_resolution ?? "720p",
    maximum_frame_count: authorization?.maximum_frame_count ?? 1,
    bounded_retry_limit: 1,
    manual_approval_required: true,
    rollback_enabled: true,
    real_output_written: realOutputWritten,
    real_output_mime_type: realOutputWritten ? "image/x-portable-pixmap" : null,
    deleted_output_targets: deletedOutputTargets,
  };
}

function buildFirstRealSynthesisPath(input: {
  authorizationRegistry: CinematicRealOutputAuthorizationRegistryEntry[];
  governedSandbox: CinematicGovernedLowResolutionSandbox;
  outputContainmentValidation: CinematicOutputContainmentValidation;
}): CinematicFirstRealSynthesisPath {
  const authorization = input.authorizationRegistry[0] ?? null;
  const blocked = input.outputContainmentValidation.blocked_transitions;
  const stages: CinematicFirstRealSynthesisStage[] = [
    "governed_output_request",
    "scheduler_bind",
    "pipeline_bind",
    "single_frame_synthesis",
    "bounded_output_write",
    "rollback_ready",
    "synthesis_archived",
  ];
  return {
    path_id: `first-real-synthesis-path-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    authorization_id: authorization?.authorization_id ?? null,
    output_file_path: input.governedSandbox.output_file_path,
    stages: stages.map((stage, index) => ({
      stage,
      order: index + 1,
      status: stage === "rollback_ready"
        ? "rollback_ready"
        : stage === "synthesis_archived"
          ? "archived"
          : input.governedSandbox.real_output_written
            ? "completed"
            : stage === "governed_output_request"
              ? "ready"
              : "blocked",
      detail: stage === "bounded_output_write"
        ? `Bounded output written to ${input.governedSandbox.output_file_path ?? "none"}.`
        : stage === "rollback_ready"
          ? `Rollback remains ready under ${authorization?.rollback_authority ?? "no-authority"}.`
          : stage === "synthesis_archived"
            ? "The first real synthesis attempt is archived append-only after bounded execution."
            : `Stage ${stage} remains governed by real output authorization ${authorization?.authorization_id ?? "none"}.`,
      blockers: input.governedSandbox.real_output_written ? [] : blocked,
    })),
    next_stage: input.governedSandbox.real_output_written ? "rollback_ready" : "governed_output_request",
  };
}

function buildRealOutputRollbackLayer(input: {
  authorizationRegistry: CinematicRealOutputAuthorizationRegistryEntry[];
  governedSandbox: CinematicGovernedLowResolutionSandbox;
  firstRealSynthesisPath: CinematicFirstRealSynthesisPath;
  outputContainmentValidation: CinematicOutputContainmentValidation;
  executionTemperatureState: CinematicExecutionTemperatureStateRecord;
}): CinematicRealOutputRollbackLayer {
  const authorization = input.authorizationRegistry[0] ?? null;
  const outputTarget = input.governedSandbox.output_file_path ? [input.governedSandbox.output_file_path] : [];
  return {
    rollback_id: `real-output-rollback-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    actions: [
      {
        action: "rollback-triggered-cleanup",
        triggered: input.governedSandbox.real_output_written,
        detail: "Rollback cleanup can remove the bounded preview frame without affecting other workspace outputs.",
        affected_output_targets: outputTarget,
      },
      {
        action: "bounded-output-deletion",
        triggered: input.governedSandbox.real_output_written,
        detail: "Bounded output deletion remains limited to the sandboxed preview frame target.",
        affected_output_targets: outputTarget,
      },
      {
        action: "emergency-shutdown-escalation",
        triggered: true,
        detail: `Emergency shutdown authority remains ${authorization?.emergency_shutdown_authority ?? "unset"}.`,
        affected_output_targets: outputTarget,
      },
      {
        action: "rollback-authority-enforcement",
        triggered: Boolean(authorization?.rollback_authority),
        detail: `Rollback authority remains ${authorization?.rollback_authority ?? "unset"}.`,
        affected_output_targets: outputTarget,
      },
      {
        action: "synthesis-attempt-archival",
        triggered: input.firstRealSynthesisPath.stages.some((entry) => entry.stage === "synthesis_archived"),
        detail: "The first real synthesis path is always archived append-only after execution or block.",
        affected_output_targets: outputTarget,
      },
      {
        action: "containment-violation-recovery",
        triggered: input.outputContainmentValidation.blocked_transitions.length > 0,
        detail: `Execution temperature remains ${input.executionTemperatureState.current_state} while containment recovery stays governed.`,
        affected_output_targets: outputTarget,
      },
    ],
  };
}

function buildFutureRendererEscalationScaffolding(input: {
  authorizationRegistry: CinematicRealOutputAuthorizationRegistryEntry[];
  outputContainmentValidation: CinematicOutputContainmentValidation;
}): CinematicFutureRendererEscalationScaffolding {
  const forbidden = uniqueNormalizedStrings(input.authorizationRegistry.flatMap((entry) => entry.forbidden_output_behaviors));
  const blockers = uniqueNormalizedStrings(input.outputContainmentValidation.checks.filter((entry) => !entry.passed).flatMap((entry) => entry.blockers));
  const milestone = "reviewed-governed-renderer-escalation-bridge";
  return {
    scaffold_id: `future-renderer-escalation-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    milestone_unlocks_renderer_escalation: milestone,
    entries: [
      {
        escalation_id: "governed-multi-frame-synthesis",
        unlocked: false,
        prerequisites: uniqueNormalizedStrings(["multi-frame governance approval", ...blockers]),
        still_forbidden_operations: forbidden,
      },
      {
        escalation_id: "governed-temporal-synthesis",
        unlocked: false,
        prerequisites: ["temporal synthesis review", "continuity-safe sequencing evidence"],
        still_forbidden_operations: forbidden,
      },
      {
        escalation_id: "continuity-safe-preview-sequences",
        unlocked: false,
        prerequisites: ["preview sequence continuity approval", "bounded renderer review"],
        still_forbidden_operations: forbidden,
      },
      {
        escalation_id: "governed-renderer-preview-mode",
        unlocked: false,
        prerequisites: ["renderer preview governance approval", "rollback proof retained"],
        still_forbidden_operations: forbidden,
      },
      {
        escalation_id: "governed-teaser-trailer-mode",
        unlocked: false,
        prerequisites: ["teaser-trailer governance approval", "multi-frame rollback coverage"],
        still_forbidden_operations: forbidden,
      },
      {
        escalation_id: "governed-cinematic-sequence-mode",
        unlocked: false,
        prerequisites: ["cinematic-sequence governance approval", "temporal containment validation"],
        still_forbidden_operations: forbidden,
      },
    ],
  };
}

function applyGatedInferencePrecursorReadiness(input: {
  readiness: CinematicLocalInferenceReadinessReport;
  activationAuthorityRegistry: CinematicActivationAuthorityRegistryEntry[];
  gateValidation: CinematicPreInferenceGateValidation;
  sequencing: CinematicInferenceEntrySequencing;
  escalationModeling: CinematicGovernanceEscalationModeling;
  futureUnlockConditions: CinematicFutureUnlockConditions;
  executionTemperatureState: CinematicExecutionTemperatureStateRecord;
  dryInferenceWarmup: CinematicDryInferenceWarmup;
  singleFrameExecutionPrecursor: CinematicSingleFrameExecutionPrecursor;
  frameStageReadiness: CinematicFrameStageReadinessValidation;
  warmupEscalationModeling: CinematicWarmupEscalationModeling;
  futureBoundedExecutionRules: CinematicFutureBoundedExecutionRules;
  dryExecutionTokenRegistry: CinematicDryExecutionTokenRegistryEntry[];
  singleFrameDryExecutionPath: CinematicSingleFrameDryExecutionPath;
  frameTraversalValidation: CinematicFrameTraversalValidation;
  dryExecutionRecovery: CinematicDryExecutionRecoveryModeling;
  futureFrameSynthesisUnlocks: CinematicFutureFrameSynthesisUnlocks;
  executionAttemptLedger: CinematicExecutionAttemptLedger;
  synthesisContainmentRegistry: CinematicSynthesisContainmentRegistryEntry[];
  governedSynthesisPreparation: CinematicGovernedSynthesisPreparationPath;
  synthesisValidationLayer: CinematicSynthesisValidationLayer;
  containedEscalationModeling: CinematicContainedEscalationModeling;
  futureLowResolutionOutput: CinematicFutureLowResolutionOutputScaffolding;
  governedRollbackLedger: CinematicGovernedRollbackLedger;
  realOutputAuthorizationRegistry: CinematicRealOutputAuthorizationRegistryEntry[];
  governedLowResolutionSandbox: CinematicGovernedLowResolutionSandbox;
  firstRealSynthesisPath: CinematicFirstRealSynthesisPath;
  outputContainmentValidation: CinematicOutputContainmentValidation;
  realOutputRollback: CinematicRealOutputRollbackLayer;
  futureRendererEscalation: CinematicFutureRendererEscalationScaffolding;
}): CinematicLocalInferenceReadinessReport {
  const sequencingCoverage = input.sequencing.stages.length > 0;
  const unlockCoverage = input.futureUnlockConditions.conditions.length > 0;
  const triggeredEscalations = input.escalationModeling.scenarios.filter((entry) => entry.triggered).length;
  const authorityCoverage = input.activationAuthorityRegistry.length > 0;
  const warmupCoverage = input.dryInferenceWarmup.stages.filter((entry) => entry.ready).length;
  const precursorCoverage = input.singleFrameExecutionPrecursor.entries.length > 0;
  const frameStageCoverage = input.frameStageReadiness.checks.filter((entry) => entry.passed).length;
  const boundedRuleCoverage = input.futureBoundedExecutionRules.rules.length > 0;
  const dryTokenCoverage = input.dryExecutionTokenRegistry.length > 0;
  const traversalCoverage = input.singleFrameDryExecutionPath.stages.length > 0;
  const traversalValidationCoverage = input.frameTraversalValidation.checks.filter((entry) => entry.passed).length;
  const synthesisUnlockCoverage = input.futureFrameSynthesisUnlocks.unlocks.length > 0;
  const synthesisContainmentCoverage = input.synthesisContainmentRegistry.length > 0;
  const synthesisPreparationCoverage = input.governedSynthesisPreparation.stages.length > 0;
  const synthesisValidationCoverage = input.synthesisValidationLayer.checks.filter((entry) => entry.passed).length;
  const futureLowResolutionCoverage = input.futureLowResolutionOutput.outputs.length > 0;
  const realOutputAuthorizationCoverage = input.realOutputAuthorizationRegistry.length > 0;
  const realSandboxCoverage = input.governedLowResolutionSandbox.real_output_written ? 1 : 0;
  const realOutputValidationCoverage = input.outputContainmentValidation.checks.filter((entry) => entry.passed).length;
  const rollbackCoverage = input.realOutputRollback.actions.filter((entry) => entry.triggered).length;
  const updatedMilestones = input.readiness.milestone_progress.map((entry) => {
    const blockers = uniqueNormalizedStrings([
      ...entry.blockers,
      ...input.gateValidation.checks.filter((check) => !check.passed).flatMap((check) => check.blockers),
      ...input.frameStageReadiness.checks.filter((check) => !check.passed).flatMap((check) => check.blockers),
    ]);
    switch (entry.milestone) {
      case "local-inference-readiness":
        return {
          ...entry,
          percentage: clampPercentage(entry.percentage + (authorityCoverage ? 3 : 0) + (sequencingCoverage ? 2 : 0) + (unlockCoverage ? 2 : 0) + (warmupCoverage >= 4 ? 4 : 0) + (dryTokenCoverage ? 3 : 0) + (traversalValidationCoverage >= 4 ? 3 : 0) + (synthesisContainmentCoverage ? 4 : 0) + (synthesisValidationCoverage >= 5 ? 3 : 0) + (realOutputAuthorizationCoverage ? 4 : 0) + (realOutputValidationCoverage >= 6 ? 4 : 0) + (input.executionTemperatureState.current_state === "simulated_only" ? 2 : 0)),
          blockers,
        };
      case "local-runtime-readiness":
        return {
          ...entry,
          percentage: clampPercentage(entry.percentage + (input.gateValidation.checks.find((check) => check.gate === "execution-boundary-intact")?.passed ? 3 : 0) + (triggeredEscalations > 0 ? 2 : 0) + (warmupCoverage >= 2 ? 3 : 0) + (traversalCoverage ? 3 : 0) + (synthesisPreparationCoverage ? 3 : 0) + (realSandboxCoverage ? 5 : 0)),
          blockers,
        };
      case "local-frame-generation-readiness":
        return {
          ...entry,
          percentage: clampPercentage(entry.percentage + (input.sequencing.stages.some((stage) => stage.stage === "gated_frame_stage_prepare") ? 2 : 0) + (frameStageCoverage >= 5 ? 4 : 0) + (precursorCoverage ? 2 : 0) + (traversalValidationCoverage >= 5 ? 4 : 0) + (synthesisPreparationCoverage ? 5 : 0) + (futureLowResolutionCoverage ? 3 : 0) + (realSandboxCoverage ? 10 : 0)),
          blockers,
        };
      case "local-renderer-readiness":
        return {
          ...entry,
          percentage: clampPercentage(entry.percentage + (input.sequencing.stages.some((stage) => stage.stage === "gated_render_output_prepare") ? 2 : 0) + (precursorCoverage ? 2 : 0) + (boundedRuleCoverage ? 2 : 0) + (synthesisUnlockCoverage ? 3 : 0) + (futureLowResolutionCoverage ? 4 : 0) + (input.futureRendererEscalation.entries.length > 0 ? 3 : 0)),
          blockers,
        };
      case "continuity-preserving-local-generation":
        return {
          ...entry,
          percentage: clampPercentage(entry.percentage + (input.gateValidation.checks.find((check) => check.gate === "continuity-state-available")?.passed ? 3 : 0) + (input.frameStageReadiness.checks.find((check) => check.check === "continuity-readiness")?.passed ? 4 : 0) + (input.synthesisValidationLayer.checks.find((check) => check.check === "continuity-state-readiness")?.passed ? 3 : 0) + (input.outputContainmentValidation.checks.find((check) => check.check === "continuity-state-integrity")?.passed ? 4 : 0)),
          blockers,
        };
      case "hybrid-local-cloud-orchestration":
        return {
          ...entry,
          percentage: clampPercentage(entry.percentage + (input.escalationModeling.scenarios.some((scenario) => scenario.escalation === "offline-mode-escalation") ? 2 : 0) + (input.warmupEscalationModeling.scenarios.some((scenario) => scenario.escalation === "hybrid-escalation") ? 2 : 0) + (input.dryExecutionRecovery.scenarios.some((scenario) => scenario.recovery === "governance-escalation-recovery") ? 2 : 0) + (input.containedEscalationModeling.scenarios.some((scenario) => scenario.triggered) ? 3 : 0) + (rollbackCoverage >= 3 ? 3 : 0)),
          blockers,
        };
      case "self-sustaining-generation-readiness":
        return {
          ...entry,
          percentage: clampPercentage(entry.percentage + 5),
          blockers: uniqueNormalizedStrings([...blockers, "Self-sustaining generation remains forbidden pending a reviewed renderer-escalation bridge."]),
        };
      default:
        return entry;
    }
  });
  return {
    ...input.readiness,
    planning_notes: uniqueNormalizedStrings([
      ...input.readiness.planning_notes,
      `Activation authority registry entries recorded: ${input.activationAuthorityRegistry.length}.`,
      `Pre-inference gate validation: ${input.gateValidation.valid ? "passed" : "blocked"}.`,
      `Execution temperature current state: ${input.executionTemperatureState.current_state}.`,
      `Dry warmup stages ready: ${warmupCoverage}/${input.dryInferenceWarmup.stages.length}.`,
      `Single-frame precursor entries scaffolded: ${input.singleFrameExecutionPrecursor.entries.length}.`,
      `Dry execution tokens recorded: ${input.dryExecutionTokenRegistry.length}.`,
      `Dry execution traversal stages recorded: ${input.singleFrameDryExecutionPath.stages.length}.`,
      `Execution attempts recorded: ${input.executionAttemptLedger.attempts.length}.`,
      `Synthesis containment records recorded: ${input.synthesisContainmentRegistry.length}.`,
      `Governed synthesis preparation stages recorded: ${input.governedSynthesisPreparation.stages.length}.`,
      `Governed rollback ledger entries recorded: ${input.governedRollbackLedger.entries.length}.`,
      `Real output authorizations recorded: ${input.realOutputAuthorizationRegistry.length}.`,
      `Real low-resolution sandbox wrote output: ${input.governedLowResolutionSandbox.real_output_written ? "yes" : "no"}.`,
      `Real output rollback actions recorded: ${input.realOutputRollback.actions.length}.`,
      `Future real inference remains locked behind ${input.futureUnlockConditions.milestone_unlocks_real_inference}.`,
      `Future governed output remains locked behind ${input.futureLowResolutionOutput.milestone_unlocks_governed_output}.`,
      `Future renderer escalation remains locked behind ${input.futureRendererEscalation.milestone_unlocks_renderer_escalation}.`,
    ]),
    blocked_reasons: uniqueNormalizedStrings([
      ...input.readiness.blocked_reasons,
      ...input.gateValidation.checks.filter((entry) => !entry.passed).map((entry) => entry.detail),
      ...input.frameStageReadiness.checks.filter((entry) => !entry.passed).map((entry) => entry.detail),
      ...input.synthesisValidationLayer.checks.filter((entry) => !entry.passed).map((entry) => entry.detail),
      ...input.outputContainmentValidation.checks.filter((entry) => !entry.passed).map((entry) => entry.detail),
    ]),
    milestone_progress: updatedMilestones,
  };
}

function buildLocalHardwareEstimate(input: {
  model: CinematicLocalVideoModelProfile;
  runtime: CinematicLocalRuntimeCapability | null;
  hardware: CinematicLocalHardwareProfile;
  desiredResolution: CinematicVideoResolution;
  desiredDurationSeconds: number;
}): CinematicLocalHardwareEstimate {
  const limitingFactors: string[] = [];
  if (input.hardware.gpu_vram_gb < input.model.vram_requirement_gb) {
    limitingFactors.push(`VRAM ${input.hardware.gpu_vram_gb}GB is below the model requirement of ${input.model.vram_requirement_gb}GB.`);
  }
  if (input.hardware.storage_free_gb < input.model.storage_requirement_gb) {
    limitingFactors.push(`Free storage ${input.hardware.storage_free_gb}GB is below the model requirement of ${input.model.storage_requirement_gb}GB.`);
  }
  if (input.runtime && !input.runtime.supported_backends.includes(input.hardware.accelerator_backend)) {
    limitingFactors.push(`${input.runtime.display_name} does not support ${input.hardware.accelerator_backend}.`);
  }
  if (videoResolutionRank(input.hardware.recommended_max_resolution) < videoResolutionRank(input.desiredResolution)) {
    limitingFactors.push(`Hardware profile is only recommended up to ${input.hardware.recommended_max_resolution}.`);
  }
  if (input.hardware.recommended_max_duration_seconds < input.desiredDurationSeconds) {
    limitingFactors.push(`Hardware profile is only recommended up to ${input.hardware.recommended_max_duration_seconds}s.`);
  }
  const resolutionFactor = videoResolutionRank(input.desiredResolution);
  const backendFactor = input.hardware.accelerator_backend === "cpu" ? 4 : 2;
  const vramFactor = Math.max(1, Math.ceil(input.model.vram_requirement_gb / Math.max(1, input.hardware.gpu_vram_gb)));
  return {
    model_id: input.model.model_id,
    runtime_id: input.runtime?.runtime_id ?? null,
    hardware_profile_id: input.hardware.profile_id,
    supported: limitingFactors.length === 0,
    estimated_generation_minutes: Math.max(2, Math.ceil((input.desiredDurationSeconds * resolutionFactor * backendFactor * vramFactor) / 3)),
    estimated_cache_gb: input.model.storage_requirement_gb + Math.max(6, resolutionFactor * input.desiredDurationSeconds),
    limiting_factors: limitingFactors,
  };
}

function resolveProviderCapability(record: CinematicProductionMemoryRecord, provider: CinematicGenerationProvider): CinematicProviderCapability {
  const capability = record.provider_capability_registry.find((entry) => entry.provider === provider);
  if (!capability) {
    throw new Error(`Unknown provider capability: ${provider}`);
  }
  return capability;
}

function providerNormalizationPrefix(provider: CinematicGenerationProvider): string {
  switch (provider) {
    case "Sora":
      return "Sora-ready cinematic prompt";
    case "Seedance":
      return "Seedance-ready storyboard prompt";
    case "Veo":
      return "Veo-ready cinematic payload";
    case "Runway":
      return "Runway-ready motion prompt";
    case "LocalFutureProvider":
      return "Local future provider planning payload";
  }
}

function normalizePromptForProvider(input: {
  provider: CinematicGenerationProvider;
  capability: CinematicProviderCapability;
  prompt: string;
  continuityContext: string[];
  cameraInstructions: string[];
  styleGuidance: string[];
}): CinematicPromptNormalizationResult {
  const providerPrompt = [
    providerNormalizationPrefix(input.provider),
    input.prompt,
    `Continuity: ${input.continuityContext.join(" | ")}`,
    `Camera: ${input.cameraInstructions.join(" | ")}`,
    `Style: ${input.styleGuidance.join(" | ")}`,
  ].join("\n");
  const trimmed = trimPromptToMaxCharacters(providerPrompt, input.capability.max_prompt_characters);
  return {
    ...trimmed,
    provider: input.provider,
  };
}

function getProviderPayloadShape(input: {
  provider: CinematicGenerationProvider;
  normalizedPrompt: string;
  durationSeconds: number;
  resolution: CinematicVideoResolution;
  frameRate: number;
  references: string[];
  cameraInstructions: string[];
}): Record<string, unknown> {
  switch (input.provider) {
    case "Sora":
      return {
        prompt: input.normalizedPrompt,
        duration_seconds: input.durationSeconds,
        output_resolution: input.resolution,
        fps: input.frameRate,
        image_references: input.references,
        camera_guidance: input.cameraInstructions,
      };
    case "Seedance":
      return {
        concise_prompt: input.normalizedPrompt,
        shot_duration_seconds: input.durationSeconds,
        delivery_resolution: input.resolution,
        storyboard_fps: input.frameRate,
        refs: input.references,
      };
    case "Veo":
      return {
        sequence_prompt: input.normalizedPrompt,
        duration_target_seconds: input.durationSeconds,
        resolution: input.resolution,
        frame_rate: input.frameRate,
        reference_assets: input.references,
        motion_notes: input.cameraInstructions,
      };
    case "Runway":
      return {
        motion_prompt: input.normalizedPrompt,
        target_duration_seconds: input.durationSeconds,
        export_resolution: input.resolution,
        fps: input.frameRate,
        reference_images: input.references,
      };
    case "LocalFutureProvider":
      return {
        planning_prompt: input.normalizedPrompt,
        requested_duration_seconds: input.durationSeconds,
        preferred_resolution: input.resolution,
        preferred_frame_rate: input.frameRate,
        references: input.references,
        deterministic_camera_notes: input.cameraInstructions,
      };
  }
}

function resolveJobContext(record: CinematicProductionMemoryRecord, jobId: string): {
  job: CinematicGenerationJob;
  sequence: CinematicSceneSequence;
  shot: CinematicSceneSequenceShot;
  beat: CinematicStoryBeat;
} {
  const job = record.generation_jobs.find((entry) => entry.job_id === jobId);
  if (!job) {
    throw new Error(`Unknown cinematic generation job id: ${jobId}`);
  }
  const sequence = record.scene_sequences.find((entry) => entry.sequence_id === job.sequence_id);
  if (!sequence) {
    throw new Error(`Unknown cinematic sequence id: ${job.sequence_id}`);
  }
  const shot = sequence.shots.find((entry) => entry.shot_id === job.shot_id);
  if (!shot) {
    throw new Error(`Unknown cinematic shot id: ${job.shot_id}`);
  }
  const beat = record.story_beats.find((entry) => entry.beat_id === sequence.beat_id);
  if (!beat) {
    throw new Error(`Unknown cinematic beat id: ${sequence.beat_id}`);
  }
  return { job, sequence, shot, beat };
}

function buildExecutionPromptPayload(input: {
  record: CinematicProductionMemoryRecord;
  sequence: CinematicSceneSequence;
  shot: CinematicSceneSequenceShot;
  beat: CinematicStoryBeat;
  route: CinematicProviderRoutingDecision;
}): CinematicGenerationPromptPayload {
  const reusableAssets = input.record.generated_assets.filter((entry) => entry.reusable).map((entry) => entry.asset_id);
  return {
    compiled_prompt: [
      `Project: ${input.record.project_key}`,
      `Sequence: ${input.sequence.title}`,
      `Shot: ${input.shot.shot_purpose}`,
      `Intent: ${input.shot.emotional_intent}`,
      `Gameplay trigger: ${input.shot.gameplay_trigger}`,
      `Camera: ${input.shot.camera_behavior}`,
      `Transition: ${input.shot.transition_notes}`,
      `Continuity: ${[...input.record.continuity_rules, ...input.shot.continuity_dependencies].join(" | ")}`,
    ].join("\n"),
    provider_payload_version: "sandbox-v1",
    camera_intent: input.shot.camera_behavior,
    asset_reuse_candidates: reusableAssets,
    execution_notes: [
      `Routing mode: ${input.route.routing_mode}`,
      `Provider rationale: ${input.route.rationale}`,
      `Beat goal: ${input.beat.emotional_goal}`,
    ],
    normalized_prompt: [
      `Project: ${input.record.project_key}`,
      `Sequence: ${input.sequence.title}`,
      `Shot: ${input.shot.shot_id}`,
      `Intent: ${input.shot.emotional_intent}`,
    ].join(" | "),
    duration_target_seconds: DEFAULT_TARGET_DURATION_SECONDS,
    resolution: DEFAULT_TARGET_RESOLUTION,
    frame_rate: DEFAULT_TARGET_FRAME_RATE,
  };
}

function resolveExecutionDependencyShotIds(sequence: CinematicSceneSequence, shot: CinematicSceneSequenceShot): string[] {
  return sequence.shots
    .filter((entry) => entry.shot_order < shot.shot_order)
    .map((entry) => entry.shot_id);
}

function batchKeyForShot(shot: CinematicSceneSequenceShot): string {
  return `${shot.environment_id}::${[...shot.character_ids].sort().join("+")}`;
}

function buildShotBatches(input: {
  sequence: CinematicSceneSequence;
  provider: CinematicGenerationProvider;
  jobs: CinematicGenerationJob[];
  regenerationOnly: boolean;
}): CinematicShotBatchPlan[] {
  const sortedShots = [...input.sequence.shots].sort((left, right) => left.shot_order - right.shot_order);
  const batches: CinematicShotBatchPlan[] = [];
  let currentShots: CinematicSceneSequenceShot[] = [];
  let currentKey: string | null = null;

  const flush = (): void => {
    if (currentShots.length === 0) {
      return;
    }
    const shotIds = currentShots.map((entry) => entry.shot_id);
    const relatedJobs = input.jobs.filter((entry) => shotIds.includes(entry.shot_id));
    batches.push({
      batch_id: `batch-${input.sequence.sequence_id}-${batches.length + 1}`,
      provider: input.provider,
      sequence_id: input.sequence.sequence_id,
      shot_ids: shotIds,
      job_ids: relatedJobs.map((entry) => entry.job_id),
      reusable_environment_ids: [...new Set(currentShots.map((entry) => entry.environment_id))],
      reusable_character_ids: [...new Set(currentShots.flatMap((entry) => entry.character_ids))],
      continuity_dependency_shot_ids: [...new Set(currentShots.flatMap((entry) => resolveExecutionDependencyShotIds(input.sequence, entry)))],
      regeneration_only: input.regenerationOnly,
    });
    currentShots = [];
    currentKey = null;
  };

  for (const shot of sortedShots) {
    const nextKey = batchKeyForShot(shot);
    if (currentKey !== null && currentKey !== nextKey) {
      flush();
    }
    currentKey = nextKey;
    currentShots.push(shot);
  }

  flush();
  return batches;
}

export function listCinematicProviderAdapters(): CinematicProviderAdapterStub[] {
  return [
    {
      provider: "Sora",
      summary: "Premium cinematic stub adapter for high-fidelity provider-ready payloads.",
      supported_modes: ["premium-cinematic-provider", "balanced-comparison-mode"],
      stub_capabilities: ["cinematic-fidelity", "provider-ready-payload-prep"],
    },
    {
      provider: "Seedance",
      summary: "Cheap draft stub adapter for low-cost storyboard-grade passes.",
      supported_modes: ["cheap-draft-provider"],
      stub_capabilities: ["fast-draft-pass", "sandbox-failure-probe"],
    },
    {
      provider: "Runway",
      summary: "Balanced comparison stub adapter for alternate provider-ready payload comparisons.",
      supported_modes: ["balanced-comparison-mode"],
      stub_capabilities: ["provider-agnostic-comparison", "alternate-payload-shape"],
    },
    {
      provider: "Veo",
      summary: "Balanced premium stub adapter for side-by-side payload comparison planning.",
      supported_modes: ["balanced-comparison-mode", "premium-cinematic-provider"],
      stub_capabilities: ["comparison-pass", "cinematic-coverage"],
    },
    {
      provider: "LocalFutureProvider",
      summary: "Future local inference and offline planning stub adapter with no real execution dependency.",
      supported_modes: ["offline-planning-mode", "future-local-inference-mode"],
      stub_capabilities: ["offline-routing", "future-local-execution-bridge"],
    },
  ];
}

export function getCinematicProviderCapabilityRegistry(input?: {
  record?: CinematicProductionMemoryRecord;
}): CinematicProviderCapability[] {
  return (input?.record ?? cloneDefaultRecord()).provider_capability_registry;
}

export async function getCinematicProviderCapability(input: {
  root?: string;
  provider: CinematicGenerationProvider;
}): Promise<CinematicProviderCapability> {
  const record = await readCinematicProductionMemory({ root: input.root });
  return resolveProviderCapability(record, input.provider);
}

export function getCinematicLocalModelRegistry(input?: {
  record?: CinematicProductionMemoryRecord;
}): CinematicLocalVideoModelProfile[] {
  return (input?.record ?? cloneDefaultRecord()).local_model_registry;
}

export function getCinematicLocalRuntimeCapabilityRegistry(input?: {
  record?: CinematicProductionMemoryRecord;
}): CinematicLocalRuntimeCapability[] {
  return (input?.record ?? cloneDefaultRecord()).local_runtime_capability_registry;
}

export function getCinematicLocalHardwareProfiles(input?: {
  record?: CinematicProductionMemoryRecord;
}): CinematicLocalHardwareProfile[] {
  return (input?.record ?? cloneDefaultRecord()).local_hardware_profiles;
}

export function getCinematicRuntimeProbeAdapters(): CinematicRuntimeProbeAdapter[] {
  return buildRuntimeProbeAdapters();
}

export async function inspectCinematicLocalRuntimeEnvironment(input?: {
  root?: string;
  persist?: boolean;
  gpuVendorHint?: string;
  pathHints?: Partial<CinematicRuntimeProbePathHints>;
}): Promise<CinematicRuntimeProbeSnapshot> {
  const initialization = await loadProductionMemory(input?.root);
  const record = initialization.record;
  const mergedPathHints: CinematicRuntimeProbePathHints = {
    cuda_paths: uniqueNormalizedStrings([
      ...record.local_runtime_probe_path_hints.cuda_paths,
      ...(input?.pathHints?.cuda_paths ?? []),
      process.env.CUDA_PATH,
    ]),
    ffmpeg_paths: uniqueNormalizedStrings([
      ...record.local_runtime_probe_path_hints.ffmpeg_paths,
      ...(input?.pathHints?.ffmpeg_paths ?? []),
    ]),
    python_paths: uniqueNormalizedStrings([
      ...record.local_runtime_probe_path_hints.python_paths,
      ...(input?.pathHints?.python_paths ?? []),
    ]),
    inference_runtime_paths: uniqueNormalizedStrings([
      ...record.local_runtime_probe_path_hints.inference_runtime_paths,
      ...(input?.pathHints?.inference_runtime_paths ?? []),
    ]),
    local_model_paths: uniqueNormalizedStrings([
      ...record.local_runtime_probe_path_hints.local_model_paths,
      ...(input?.pathHints?.local_model_paths ?? []),
    ]),
  };
  const cudaMatches = existingPathsFromCandidates(initialization.repoRoot, mergedPathHints.cuda_paths);
  const ffmpegMatches = uniqueNormalizedStrings([
    ...existingPathsFromCandidates(initialization.repoRoot, mergedPathHints.ffmpeg_paths),
    ...findExecutablesInPath(["ffmpeg.exe", "ffmpeg"]),
  ]);
  const pythonMatches = uniqueNormalizedStrings([
    ...existingPathsFromCandidates(initialization.repoRoot, mergedPathHints.python_paths),
    ...findExecutablesInPath(["python.exe", "python"]),
  ]);
  const inferenceMatches = existingPathsFromCandidates(initialization.repoRoot, mergedPathHints.inference_runtime_paths);
  const modelMatches = existingPathsFromCandidates(initialization.repoRoot, mergedPathHints.local_model_paths);
  const gpuVendor = resolveGpuVendor({
    hardwareProfiles: record.local_hardware_profiles,
    gpuVendorHint: input?.gpuVendorHint,
  });
  const maxVram = record.local_hardware_profiles.reduce((max, entry) => Math.max(max, entry.gpu_vram_gb), 0);
  const maxStorage = record.local_hardware_profiles.reduce((max, entry) => Math.max(max, entry.storage_free_gb), 0);
  const results: CinematicRuntimeProbeResult[] = [
    {
      probe_id: "cuda-installation",
      status: cudaMatches.length > 0 ? "detected" : process.env.CUDA_PATH ? "derived" : "not-detected",
      detail: cudaMatches.length > 0
        ? `Detected ${cudaMatches.length} CUDA installation path hint(s).`
        : process.env.CUDA_PATH
          ? "CUDA visibility is derived from the CUDA_PATH environment variable only."
          : "CUDA installation paths were not detected.",
      candidate_paths: resolveCandidatePaths(initialization.repoRoot, mergedPathHints.cuda_paths),
      detected_paths: cudaMatches,
      observed_value: cudaMatches[0] ?? (normalizeText(process.env.CUDA_PATH) || null),
      blockers: cudaMatches.length > 0 || process.env.CUDA_PATH ? [] : ["CUDA install root not found in bounded hints."],
    },
    {
      probe_id: "gpu-vendor-visibility",
      status: gpuVendor ? "derived" : "not-detected",
      detail: gpuVendor
        ? `GPU vendor visibility is inferred as ${gpuVendor}.`
        : "GPU vendor visibility could not be inferred from bounded signals.",
      candidate_paths: [],
      detected_paths: [],
      observed_value: gpuVendor,
      blockers: gpuVendor ? [] : ["No bounded GPU vendor hint is available."],
    },
    {
      probe_id: "vram-reporting-capability",
      status: maxVram > 0 ? "derived" : "not-detected",
      detail: maxVram > 0
        ? `Stored hardware profiles expose up to ${maxVram}GB VRAM.`
        : "Stored hardware profiles do not expose VRAM evidence.",
      candidate_paths: [],
      detected_paths: [],
      observed_value: maxVram > 0 ? `${maxVram}GB` : null,
      blockers: maxVram > 0 ? [] : ["No hardware profile contains VRAM data."],
    },
    {
      probe_id: "ffmpeg-availability",
      status: ffmpegMatches.length > 0 ? "detected" : "not-detected",
      detail: ffmpegMatches.length > 0
        ? `Detected ${ffmpegMatches.length} FFmpeg executable path hint(s).`
        : "FFmpeg executable was not detected in bounded paths or PATH.",
      candidate_paths: resolveCandidatePaths(initialization.repoRoot, mergedPathHints.ffmpeg_paths),
      detected_paths: ffmpegMatches,
      observed_value: ffmpegMatches[0] ?? null,
      blockers: ffmpegMatches.length > 0 ? [] : ["FFmpeg executable is missing from bounded search paths."],
    },
    {
      probe_id: "python-runtime-presence",
      status: pythonMatches.length > 0 ? "detected" : "not-detected",
      detail: pythonMatches.length > 0
        ? `Detected ${pythonMatches.length} Python runtime path hint(s).`
        : "Python runtime was not detected in bounded paths or PATH.",
      candidate_paths: resolveCandidatePaths(initialization.repoRoot, mergedPathHints.python_paths),
      detected_paths: pythonMatches,
      observed_value: pythonMatches[0] ?? null,
      blockers: pythonMatches.length > 0 ? [] : ["Python runtime is not visible to bounded inspection."],
    },
    {
      probe_id: "inference-runtime-presence",
      status: inferenceMatches.length > 0 ? "detected" : "not-detected",
      detail: inferenceMatches.length > 0
        ? `Detected ${inferenceMatches.length} inference runtime path hint(s).`
        : "Inference runtime folders were not detected in bounded configured paths.",
      candidate_paths: resolveCandidatePaths(initialization.repoRoot, mergedPathHints.inference_runtime_paths),
      detected_paths: inferenceMatches,
      observed_value: inferenceMatches[0] ?? null,
      blockers: inferenceMatches.length > 0 ? [] : ["Inference runtime folder is not visible to bounded inspection."],
    },
    {
      probe_id: "local-model-directory-presence",
      status: modelMatches.length > 0 ? "detected" : "not-detected",
      detail: modelMatches.length > 0
        ? `Detected ${modelMatches.length} local model directory hint(s).`
        : "Local model directories were not detected in bounded configured paths.",
      candidate_paths: resolveCandidatePaths(initialization.repoRoot, mergedPathHints.local_model_paths),
      detected_paths: modelMatches,
      observed_value: modelMatches[0] ?? null,
      blockers: modelMatches.length > 0 ? [] : ["Local model directory is not visible to bounded inspection."],
    },
    {
      probe_id: "storage-space-estimate",
      status: maxStorage > 0 ? "derived" : "not-detected",
      detail: maxStorage > 0
        ? `Stored hardware profiles expose up to ${maxStorage}GB free storage.`
        : "Stored hardware profiles do not expose a free-storage estimate.",
      candidate_paths: [],
      detected_paths: [],
      observed_value: maxStorage > 0 ? `${maxStorage}GB` : null,
      blockers: maxStorage > 0 ? [] : ["No hardware profile contains storage estimates."],
    },
  ];
  const snapshot: CinematicRuntimeProbeSnapshot = {
    snapshot_id: `runtime-probe-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`,
    recorded_at: new Date().toISOString(),
    runtime_launch_enabled: false,
    gpu_vendor: gpuVendor,
    storage_free_gb_estimate: maxStorage > 0 ? maxStorage : null,
    results,
  };
  if (input?.persist) {
    await writeProductionMemoryRecord(initialization.productionMemoryPath, {
      ...record,
      local_runtime_probe_path_hints: mergedPathHints,
      local_runtime_probe_snapshots: [snapshot, ...record.local_runtime_probe_snapshots].slice(0, 12),
    });
  }
  return snapshot;
}

export function getCinematicFrameGenerationStageRegistry(input?: {
  record?: CinematicProductionMemoryRecord;
}): CinematicFrameGenerationStage[] {
  return (input?.record ?? cloneDefaultRecord()).frame_generation_stage_registry;
}

export function getCinematicRendererCapabilityRoadmap(input?: {
  record?: CinematicProductionMemoryRecord;
}): CinematicRendererCapabilityRoadmapEntry[] {
  return (input?.record ?? cloneDefaultRecord()).renderer_capability_roadmap;
}

export function getCinematicRuntimeConstraintModels(input?: {
  record?: CinematicProductionMemoryRecord;
}): CinematicRuntimeConstraintModel[] {
  return (input?.record ?? cloneDefaultRecord()).runtime_constraint_models;
}

export function getCinematicHybridLocalCloudStrategies(input?: {
  record?: CinematicProductionMemoryRecord;
}): CinematicHybridLocalCloudStrategy[] {
  return (input?.record ?? cloneDefaultRecord()).hybrid_local_cloud_strategies;
}

export async function planCinematicFrameGenerationPipeline(input?: {
  root?: string;
}): Promise<CinematicFrameGenerationPipelinePlan> {
  const record = await readCinematicProductionMemory({ root: input?.root });
  const stages = record.frame_generation_stage_registry;
  return {
    stages,
    blocked_stage_ids: stages.filter((entry) => entry.status === "planned").map((entry) => entry.stage_id),
    continuity_critical_stage_ids: stages.filter((entry) => entry.continuity_critical).map((entry) => entry.stage_id),
    readiness_percentage: clampPercentage(averageScore(stages.map((entry) => frameStageStatusScore(entry.status))) * 100),
    notes: uniqueNormalizedStrings(stages.flatMap((entry) => entry.notes)),
  };
}

export async function assessCinematicRuntimeConstraints(input?: {
  root?: string;
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
}): Promise<CinematicRuntimeConstraintAssessment> {
  const record = await readCinematicProductionMemory({ root: input?.root });
  const readiness = summarizeLocalReadiness({
    record,
    desiredResolution: input?.desiredResolution ?? DEFAULT_TARGET_RESOLUTION,
    desiredDurationSeconds: input?.desiredDurationSeconds ?? DEFAULT_TARGET_DURATION_SECONDS,
    continuityPriority: input?.continuityPriority ?? "medium",
  });
  const selectedModel = record.runtime_constraint_models[0] ?? null;
  const limitations = uniqueNormalizedStrings([
    ...readiness.blocked_reasons,
    ...selectedModel?.local_queue_pressure ?? [],
  ]);
  const recommendations = uniqueNormalizedStrings([
    ...selectedModel?.hybrid_offload_recommendations ?? [],
    ...(readiness.local_provider_available ? [] : ["Favor offline-safe-mode or cloud-premium-rendering until runtime probe evidence improves."]),
  ]);
  return {
    selected_constraint_model_id: selectedModel?.model_id ?? null,
    probe_snapshot_id: readiness.probe_snapshot?.snapshot_id ?? null,
    preferred_hardware_profile_id: readiness.preferred_hardware_profile_id,
    limitations,
    recommendations,
  };
}

export async function getCinematicReadinessMilestoneProgress(input?: {
  root?: string;
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
}): Promise<CinematicReadinessMilestoneProgress[]> {
  const readiness = await assessCinematicLocalInferenceReadiness(input);
  return readiness.milestone_progress;
}

export async function assessCinematicLocalInferenceReadiness(input?: {
  root?: string;
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
}): Promise<CinematicLocalInferenceReadinessReport> {
  const record = await readCinematicProductionMemory({ root: input?.root });
  return summarizeLocalReadiness({
    record,
    desiredResolution: input?.desiredResolution ?? DEFAULT_TARGET_RESOLUTION,
    desiredDurationSeconds: input?.desiredDurationSeconds ?? DEFAULT_TARGET_DURATION_SECONDS,
    continuityPriority: input?.continuityPriority ?? "medium",
  });
}

function confidenceTrend(input: {
  previous: CinematicReadinessConfidence | null;
  current: CinematicReadinessConfidence;
}): CinematicReadinessConfidenceTrend {
  if (!input.previous) {
    return "new";
  }
  const rank: Record<CinematicReadinessConfidence, number> = {
    low: 1,
    medium: 2,
    high: 3,
  };
  if (rank[input.current] > rank[input.previous]) {
    return "up";
  }
  if (rank[input.current] < rank[input.previous]) {
    return "down";
  }
  return "flat";
}

function appendReadinessDeltaTracking(input: {
  record: CinematicProductionMemoryRecord;
  readiness: CinematicLocalInferenceReadinessReport;
  source: CinematicReadinessDeltaTrackingRecord["source"];
}): {
  tracking: CinematicReadinessDeltaTrackingRecord;
  record: CinematicProductionMemoryRecord;
} {
  const previous = input.record.readiness_delta_tracking_history[0] ?? null;
  const previousMilestones = new Map(previous?.milestones.map((entry) => [entry.milestone, entry]));
  const tracking: CinematicReadinessDeltaTrackingRecord = {
    tracking_id: `readiness-delta-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`,
    source: input.source,
    recorded_at: new Date().toISOString(),
    milestones: input.readiness.milestone_progress.map((milestone) => {
      const previousMilestone = previousMilestones.get(milestone.milestone);
      const blockersCleared = previousMilestone
        ? previousMilestone.blockers_introduced.filter((entry) => !milestone.missing_dependencies.includes(entry))
        : [];
      const blockersIntroduced = milestone.missing_dependencies.filter((entry) => !previousMilestone?.blockers_introduced.includes(entry));
      return {
        milestone: milestone.milestone,
        previous_percentage: previousMilestone?.current_percentage ?? null,
        current_percentage: milestone.percentage,
        delta: milestone.percentage - (previousMilestone?.current_percentage ?? 0),
        previous_confidence: previousMilestone?.current_confidence ?? null,
        current_confidence: milestone.confidence,
        blockers_cleared: blockersCleared,
        blockers_introduced: blockersIntroduced,
        confidence_trend: confidenceTrend({ previous: previousMilestone?.current_confidence ?? null, current: milestone.confidence }),
        architectural_readiness_notes: uniqueNormalizedStrings([
          milestone.estimated_architectural_dependency,
          `Next milestone: ${milestone.next_milestone}`,
          milestone.missing_dependencies.length > 0
            ? `Missing dependencies: ${milestone.missing_dependencies.join(", ")}`
            : "No missing dependencies currently recorded.",
        ]),
      } satisfies CinematicReadinessMilestoneDelta;
    }),
  };
  const nextRecord: CinematicProductionMemoryRecord = {
    ...input.record,
    readiness_delta_tracking_history: [tracking, ...input.record.readiness_delta_tracking_history].slice(0, 24),
  };
  return {
    tracking,
    record: nextRecord,
  };
}

function resolveSandboxSequence(input: {
  record: CinematicProductionMemoryRecord;
  sequenceId?: string;
}): CinematicSceneSequence | null {
  if (input.sequenceId) {
    return input.record.scene_sequences.find((entry) => entry.sequence_id === input.sequenceId) ?? null;
  }
  return input.record.scene_sequences[0] ?? null;
}

function buildCinematicGpuAllocationModel(input: {
  record: CinematicProductionMemoryRecord;
  readiness: CinematicLocalInferenceReadinessReport;
  hardwareEstimate: CinematicLocalHardwareEstimate | null;
  desiredDurationSeconds: number;
  queueDepth: number;
}): CinematicGpuAllocationModel {
  const preferredHardware = input.readiness.preferred_hardware_profile_id
    ? input.record.local_hardware_profiles.find((entry) => entry.profile_id === input.readiness.preferred_hardware_profile_id) ?? null
    : null;
  const selectedConstraintModel = input.record.runtime_constraint_models[0] ?? null;
  const availableVram = preferredHardware?.gpu_vram_gb ?? 0;
  const estimatedRequiredVram = Math.max(6, Math.round((((input.hardwareEstimate?.estimated_generation_minutes ?? 8) / 4) + (input.desiredDurationSeconds / 6)) * 10) / 10);
  const pressureRatio = availableVram > 0 ? estimatedRequiredVram / availableVram : Number.POSITIVE_INFINITY;
  const pressure: CinematicGpuPressureLevel = pressureRatio <= 0.55
    ? "low"
    : pressureRatio <= 0.8
      ? "medium"
      : pressureRatio <= 1
        ? "high"
        : "critical";
  const storageRatio = preferredHardware && input.hardwareEstimate
    ? input.hardwareEstimate.estimated_cache_gb / Math.max(preferredHardware.storage_free_gb, 1)
    : Number.POSITIVE_INFINITY;
  const localCachePressure: CinematicGpuPressureLevel = storageRatio <= 0.25
    ? "low"
    : storageRatio <= 0.5
      ? "medium"
      : storageRatio <= 0.75
        ? "high"
        : "critical";
  const maxSafeConcurrency = pressure === "critical"
    ? 0
    : Math.max(1, Math.floor(Math.max(availableVram, 0) / Math.max(estimatedRequiredVram, 1)));
  return {
    estimated_vram_required_gb: estimatedRequiredVram,
    available_vram_gb: availableVram,
    vram_pressure: pressure,
    render_concurrency_viable: maxSafeConcurrency >= 1 && input.readiness.foundation_ready,
    max_safe_concurrency: maxSafeConcurrency,
    queue_starvation_risk: pressure === "critical" || input.queueDepth > 4
      ? "high"
      : pressure === "high" || input.queueDepth > 2
        ? "medium"
        : "low",
    low_vram_fallback_viable: selectedConstraintModel?.low_vram_fallback_viable ?? false,
    local_cache_pressure: localCachePressure,
    storage_expansion_risk: localCachePressure === "critical"
      ? "high"
      : localCachePressure === "high"
        ? "medium"
        : "low",
    notes: uniqueNormalizedStrings([
      ...(input.hardwareEstimate?.limiting_factors ?? []),
      ...selectedConstraintModel?.local_queue_pressure ?? [],
      pressure === "critical"
        ? "VRAM headroom is insufficient for even single-job local execution simulation."
        : "Simulation assumes serialized local queue ownership rather than uncontrolled parallel rendering.",
    ]),
  };
}

function buildLocalQueueSimulationPlan(input: {
  record: CinematicProductionMemoryRecord;
  sequence: CinematicSceneSequence | null;
  readiness: CinematicLocalInferenceReadinessReport;
  gpuAllocation: CinematicGpuAllocationModel;
  continuityPriority: "low" | "medium" | "high";
}): CinematicLocalQueueSimulationPlan {
  const shots = input.sequence
    ? [...input.sequence.shots].sort((left, right) => left.shot_order - right.shot_order)
    : [];
  const failedShotIds = new Set(input.record.failed_generations.map((entry) => entry.shot_id));
  const queuedJobs = shots.map((shot, index) => {
    const dependencyJobIds = index > 0 ? [`local-sandbox-${input.sequence!.sequence_id}-${shots[index - 1]!.shot_id}`] : [];
    const jobId = `local-sandbox-${input.sequence!.sequence_id}-${shot.shot_id}`;
    const retryIsolated = failedShotIds.has(shot.shot_id);
    const blockedReason = !input.readiness.local_provider_available
      ? input.readiness.blocked_reasons[0] ?? "Local provider readiness is incomplete."
      : input.gpuAllocation.vram_pressure === "critical"
        ? "GPU allocation model predicts critical VRAM pressure."
        : null;
    const state: CinematicLocalQueueSimulationState = blockedReason
      ? "blocked"
      : retryIsolated
        ? "retry-isolated"
        : index === 0
          ? "ready"
          : "queued";
    return {
      job_id: jobId,
      shot_id: shot.shot_id,
      state,
      dependency_job_ids: dependencyJobIds,
      continuity_priority: input.continuityPriority,
      retry_isolated: retryIsolated,
      blocked_reason: blockedReason,
    } satisfies CinematicLocalQueueSimulationJob;
  });
  return {
    queued_jobs: queuedJobs,
    dependency_order_job_ids: queuedJobs.map((entry) => entry.job_id),
    continuity_priority_job_ids: queuedJobs.filter((entry) => entry.continuity_priority === "high").map((entry) => entry.job_id),
    blocked_job_ids: queuedJobs.filter((entry) => entry.state === "blocked").map((entry) => entry.job_id),
    recovery_sequence_job_ids: queuedJobs.filter((entry) => entry.retry_isolated || entry.state === "blocked").map((entry) => entry.job_id),
  };
}

function buildRendererLifecycleStates(input: {
  readiness: CinematicLocalInferenceReadinessReport;
  queuePlan: CinematicLocalQueueSimulationPlan;
  gpuAllocation: CinematicGpuAllocationModel;
}): CinematicLocalRendererLifecycleState[] {
  const blocked = !input.readiness.local_provider_available || input.gpuAllocation.vram_pressure === "critical";
  const baseStates: Array<Omit<CinematicLocalRendererLifecycleState, "order">> = [
    {
      state: "runtime_idle",
      simulated: true,
      detail: "Renderer remains idle until a manual bridge exists.",
      blockers: [],
    },
    {
      state: "runtime_preparing",
      simulated: true,
      detail: "Sandbox validates runtime prerequisites without launching anything.",
      blockers: input.readiness.blocked_reasons,
    },
    {
      state: "model_loading",
      simulated: true,
      detail: "Model load is simulated from stored registry and runtime probe evidence.",
      blockers: input.readiness.preferred_model_id ? [] : ["No preferred local model is currently ready."],
    },
    {
      state: "resource_allocating",
      simulated: true,
      detail: "GPU, storage, and queue ownership are modeled without allocating resources.",
      blockers: input.gpuAllocation.vram_pressure === "critical" ? ["Critical VRAM pressure predicted."] : [],
    },
    {
      state: blocked ? "runtime_blocked" : "frame_pipeline_ready",
      simulated: true,
      detail: blocked
        ? "Renderer lifecycle pauses before frame pipeline entry because readiness remains incomplete."
        : "Frame pipeline is considered ready for future manual-only bridge work.",
      blockers: blocked ? input.readiness.blocked_reasons : [],
    },
    {
      state: blocked ? "runtime_recovering" : "rendering_simulated",
      simulated: true,
      detail: blocked
        ? "Recovery planning is generated instead of running a render stage."
        : "Rendering remains simulated and bounded by queue orchestration rules.",
      blockers: blocked ? input.queuePlan.blocked_job_ids : [],
    },
    {
      state: blocked ? "runtime_blocked" : "packaging_simulated",
      simulated: true,
      detail: blocked
        ? "Packaging stays blocked until lifecycle blockers are cleared."
        : "Packaging and archival steps remain simulated only.",
      blockers: blocked ? input.readiness.blocked_reasons : [],
    },
    {
      state: blocked ? "runtime_blocked" : "archival_ready",
      simulated: true,
      detail: blocked
        ? "Archival readiness is deferred behind blocked lifecycle prerequisites."
        : "Archival manifests can be prepared without enabling rendering.",
      blockers: blocked ? input.readiness.blocked_reasons : [],
    },
  ];
  return baseStates.map((entry, index) => ({
    ...entry,
    order: index + 1,
  }));
}

function buildRendererRecoveryPlan(input: {
  readiness: CinematicLocalInferenceReadinessReport;
  gpuAllocation: CinematicGpuAllocationModel;
  queuePlan: CinematicLocalQueueSimulationPlan;
}): CinematicRendererRecoveryPlan {
  const causes: CinematicRendererRecoveryCause[] = [];
  if (!input.readiness.local_provider_available) {
    causes.push("dependency-mismatch");
  }
  if (input.gpuAllocation.vram_pressure === "critical") {
    causes.push("insufficient-vram");
  }
  if (input.gpuAllocation.storage_expansion_risk === "high") {
    causes.push("storage-exhaustion");
  }
  if (input.queuePlan.recovery_sequence_job_ids.length > 0) {
    causes.push("continuity-state-recovery");
  }
  const uniqueCauses = [...new Set(causes)];
  const steps = uniqueCauses.map((cause, index) => ({
    cause,
    sequence_order: index + 1,
    detail: (() => {
      switch (cause) {
        case "dependency-mismatch":
          return "Clear missing runtime/model dependencies before any manual bridge review.";
        case "insufficient-vram":
          return "Downgrade resolution or keep queue serialized until VRAM headroom improves.";
        case "storage-exhaustion":
          return "Reserve additional cache/storage headroom before simulating packaging-heavy workloads.";
        case "continuity-state-recovery":
          return "Replay retry-isolated shots after preserving successful neighboring continuity context.";
        case "failed-render-stage":
          return "Re-enter the last validated lifecycle checkpoint rather than widening execution scope.";
        case "runtime-corruption":
          return "Reset the future bridge environment manually outside this planning layer.";
      }
    })(),
  }));
  return {
    blocked: uniqueCauses.length > 0,
    causes: uniqueCauses,
    steps,
  };
}

function buildHybridEscalationSimulation(input: {
  record: CinematicProductionMemoryRecord;
  readiness: CinematicLocalInferenceReadinessReport;
  continuityPriority: "low" | "medium" | "high";
  desiredDurationSeconds: number;
}): CinematicHybridEscalationSimulation {
  const strategyIds = selectHybridStrategyIds({
    record: input.record,
    readiness: input.readiness,
    continuityPriority: input.continuityPriority,
    desiredDurationSeconds: input.desiredDurationSeconds,
    offline: !input.readiness.local_provider_available,
  });
  const selectedStrategy = strategyIds[0] ?? null;
  const strategyRecord = selectedStrategy
    ? input.record.hybrid_local_cloud_strategies.find((entry) => entry.strategy_id === selectedStrategy) ?? null
    : null;
  const selectedRoutingMode = strategyRecord?.preferred_provider_mode
    ?? input.readiness.recommended_routing_mode;
  return {
    local_first_rendering: input.readiness.local_provider_available,
    cloud_escalation_fallback: !input.readiness.local_provider_available,
    offline_safe_execution: selectedRoutingMode === "offline-planning-mode",
    premium_provider_escalation: selectedRoutingMode === "premium-cinematic-provider",
    continuity_preserving_escalation: input.continuityPriority === "high" || selectedStrategy === "continuity-first-routing",
    selected_strategy_id: selectedStrategy,
    selected_routing_mode: selectedRoutingMode,
    reasons: uniqueNormalizedStrings([
      ...input.readiness.blocked_reasons,
      ...strategyRecord?.escalation_conditions ?? [],
      selectedStrategy ? `Selected hybrid strategy ${selectedStrategy}.` : "No hybrid escalation strategy selected.",
    ]),
  };
}

export async function getCinematicReadinessDeltaTrackingHistory(input?: {
  root?: string;
}): Promise<CinematicReadinessDeltaTrackingRecord[]> {
  const record = await readCinematicProductionMemory({ root: input?.root });
  return record.readiness_delta_tracking_history;
}

export async function getCinematicLocalModelLoaderRegistry(input?: {
  root?: string;
}): Promise<CinematicLocalModelLoaderRecord[]> {
  const record = await readCinematicProductionMemory({ root: input?.root });
  return record.local_model_loader_registry;
}

export async function validateCinematicLocalExecutionSandbox(input?: {
  root?: string;
  sequenceId?: string;
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
}): Promise<CinematicLocalExecutionSandboxValidation> {
  const initialization = await loadProductionMemory(input?.root);
  const record = initialization.record;
  const desiredResolution = input?.desiredResolution ?? DEFAULT_TARGET_RESOLUTION;
  const desiredDurationSeconds = input?.desiredDurationSeconds ?? DEFAULT_TARGET_DURATION_SECONDS;
  const continuityPriority = input?.continuityPriority ?? "medium";
  const readiness = summarizeLocalReadiness({
    record,
    desiredResolution,
    desiredDurationSeconds,
    continuityPriority,
  });
  const preferredModel = readiness.preferred_model_id
    ? record.local_model_registry.find((entry) => entry.model_id === readiness.preferred_model_id) ?? null
    : null;
  const preferredHardware = preferredModel && readiness.preferred_hardware_profile_id
    ? record.local_hardware_profiles.find((entry) => entry.profile_id === readiness.preferred_hardware_profile_id) ?? null
    : null;
  const preferredRuntime = preferredHardware
    ? resolvePreferredLocalRuntime({ record, hardware: preferredHardware })
    : null;
  const hardwareEstimate = preferredModel && preferredHardware
    ? buildLocalHardwareEstimate({
      model: preferredModel,
      runtime: preferredRuntime,
      hardware: preferredHardware,
      desiredResolution,
      desiredDurationSeconds,
    })
    : null;
  const sequence = resolveSandboxSequence({ record, sequenceId: input?.sequenceId });
  const queuePlan = buildLocalQueueSimulationPlan({
    record,
    sequence,
    readiness,
    gpuAllocation: buildCinematicGpuAllocationModel({
      record,
      readiness,
      hardwareEstimate,
      desiredDurationSeconds,
      queueDepth: sequence?.shots.length ?? 0,
    }),
    continuityPriority,
  });
  const gpuAllocation = buildCinematicGpuAllocationModel({
    record,
    readiness,
    hardwareEstimate,
    desiredDurationSeconds,
    queueDepth: queuePlan.queued_jobs.length,
  });
  const normalizedQueuePlan = buildLocalQueueSimulationPlan({
    record,
    sequence,
    readiness,
    gpuAllocation,
    continuityPriority,
  });
  const rendererLifecycleStates = buildRendererLifecycleStates({
    readiness,
    queuePlan: normalizedQueuePlan,
    gpuAllocation,
  });
  const recoveryPlan = buildRendererRecoveryPlan({
    readiness,
    gpuAllocation,
    queuePlan: normalizedQueuePlan,
  });
  const hybridEscalation = buildHybridEscalationSimulation({
    record,
    readiness,
    continuityPriority,
    desiredDurationSeconds,
  });
  const trackingUpdate = appendReadinessDeltaTracking({
    record,
    readiness,
    source: "local-readiness-validation",
  });
  await writeProductionMemoryRecord(initialization.productionMemoryPath, trackingUpdate.record);
  return {
    readiness,
    readiness_delta: trackingUpdate.tracking,
    renderer_lifecycle_states: rendererLifecycleStates,
    gpu_allocation: gpuAllocation,
    queue_plan: normalizedQueuePlan,
    recovery_plan: recoveryPlan,
    hybrid_escalation: hybridEscalation,
    execution_enabled: false,
  };
}

export async function simulateCinematicLocalInferenceExecutionSandbox(input?: {
  root?: string;
  sequenceId?: string;
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
}): Promise<CinematicLocalInferenceExecutionSandboxResult> {
  const validation = await validateCinematicLocalExecutionSandbox(input);
  const record = await readCinematicProductionMemory({ root: input?.root });
  const sequence = resolveSandboxSequence({ record, sequenceId: input?.sequenceId });
  const simulation: CinematicSandboxSimulationRecord = {
    simulation_id: `local-sandbox-${(sequence?.sequence_id ?? "planning").toLowerCase()}-${Date.now()}`,
    sandbox_kind: "local-inference-execution-sandbox",
    sequence_id: sequence?.sequence_id ?? "planning-only-local-sandbox",
    routing_mode: validation.hybrid_escalation.selected_routing_mode,
    provider: "LocalFutureProvider",
    execution_enabled: false,
    queued_job_ids: validation.queue_plan.dependency_order_job_ids,
    approved_job_ids: validation.queue_plan.queued_jobs
      .filter((entry) => entry.state === "ready" || entry.state === "completed-simulated")
      .map((entry) => entry.job_id),
    failed_job_ids: validation.queue_plan.blocked_job_ids,
    retry_job_ids: validation.queue_plan.queued_jobs.filter((entry) => entry.retry_isolated).map((entry) => entry.job_id),
    continuity_issue_count: validation.queue_plan.blocked_job_ids.length,
    asset_reuse_decisions: validation.queue_plan.queued_jobs.map((entry) => `Preserve continuity context for ${entry.shot_id} while keeping local execution disabled.`),
    renderer_lifecycle_states: validation.renderer_lifecycle_states,
    gpu_allocation: validation.gpu_allocation,
    queue_plan: validation.queue_plan,
    recovery_plan: validation.recovery_plan,
    readiness_tracking_id: validation.readiness_delta.tracking_id,
    hybrid_escalation: validation.hybrid_escalation,
    recorded_at: new Date().toISOString(),
  };
  await writeCinematicProductionMemory({
    root: input?.root,
    value: {
      sandbox_simulations: [...record.sandbox_simulations, simulation].slice(-40),
      asset_reuse_decisions: [...record.asset_reuse_decisions, ...simulation.asset_reuse_decisions].slice(-40),
    },
  });
  return {
    validation,
    simulation,
  };
}

export async function validateCinematicLocalRuntimeActivationSimulation(input?: {
  root?: string;
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
}): Promise<CinematicRuntimeActivationSimulationValidation> {
  const initialization = await loadProductionMemory(input?.root);
  const record = initialization.record;
  const desiredResolution = input?.desiredResolution ?? DEFAULT_TARGET_RESOLUTION;
  const desiredDurationSeconds = input?.desiredDurationSeconds ?? DEFAULT_TARGET_DURATION_SECONDS;
  const continuityPriority = input?.continuityPriority ?? "medium";
  const loaderRegistry = buildLocalModelLoaderRegistry({
    record,
    desiredResolution,
    desiredDurationSeconds,
    continuityPriority,
  });
  const nextRecord = {
    ...record,
    local_model_loader_registry: loaderRegistry,
  };
  const readiness = summarizeLocalReadiness({
    record: nextRecord,
    desiredResolution,
    desiredDurationSeconds,
    continuityPriority,
  });
  const compatibilityValidation = validateModelRuntimeCompatibility({
    record: nextRecord,
    loaderRegistry,
    desiredResolution,
    desiredDurationSeconds,
    continuityPriority,
  });
  const activationLifecycleStates = buildRuntimeActivationSimulationStates({
    loaderRegistry,
    compatibility: compatibilityValidation,
  });
  const activationRecoveryPlan = buildActivationFailureRecoveryPlan({
    record: nextRecord,
    compatibility: compatibilityValidation,
    loaderRegistry,
  });
  const futureActivationPlan = buildFutureActivationPlan({
    compatibility: compatibilityValidation,
  });
  const trackingUpdate = appendReadinessDeltaTracking({
    record: nextRecord,
    readiness,
    source: "runtime-activation-simulation",
  });
  await writeProductionMemoryRecord(initialization.productionMemoryPath, trackingUpdate.record);
  return {
    readiness,
    readiness_delta: trackingUpdate.tracking,
    loader_registry: loaderRegistry,
    activation_lifecycle_states: activationLifecycleStates,
    compatibility_validation: compatibilityValidation,
    activation_recovery_plan: activationRecoveryPlan,
    future_activation_plan: futureActivationPlan,
    execution_enabled: false,
  };
}

export async function simulateCinematicLocalModelLoaderRuntimeActivation(input?: {
  root?: string;
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
}): Promise<CinematicLocalModelLoaderRuntimeActivationResult> {
  const validation = await validateCinematicLocalRuntimeActivationSimulation(input);
  const record = await readCinematicProductionMemory({ root: input?.root });
  const simulation: CinematicSandboxSimulationRecord = {
    simulation_id: `activation-sandbox-${Date.now()}`,
    sandbox_kind: "local-model-loader-runtime-activation-simulation",
    sequence_id: "runtime-activation-planning-only",
    routing_mode: validation.readiness.recommended_routing_mode,
    provider: "LocalFutureProvider",
    execution_enabled: false,
    queued_job_ids: validation.loader_registry.map((entry) => entry.loader_id),
    approved_job_ids: validation.loader_registry.filter((entry) => entry.status === "activation-ready").map((entry) => entry.loader_id),
    failed_job_ids: validation.compatibility_validation.issues.map((entry) => entry.loader_id),
    retry_job_ids: validation.activation_recovery_plan.causes.length > 0
      ? validation.loader_registry.filter((entry) => entry.status !== "activation-ready").map((entry) => entry.loader_id)
      : [],
    continuity_issue_count: validation.compatibility_validation.issues.filter((entry) => entry.code === "unsupported-continuity-mode").length,
    asset_reuse_decisions: validation.loader_registry.map((entry) => `Keep ${entry.loader_id} activation simulated-only and governance-bound.`),
    loader_registry: validation.loader_registry,
    activation_lifecycle_states: validation.activation_lifecycle_states,
    compatibility_validation: validation.compatibility_validation,
    activation_recovery_plan: validation.activation_recovery_plan,
    future_activation_plan: validation.future_activation_plan,
    readiness_tracking_id: validation.readiness_delta.tracking_id,
    hybrid_escalation: null,
    recorded_at: new Date().toISOString(),
  };
  await writeCinematicProductionMemory({
    root: input?.root,
    value: {
      sandbox_simulations: [...record.sandbox_simulations, simulation].slice(-40),
      asset_reuse_decisions: [...record.asset_reuse_decisions, ...simulation.asset_reuse_decisions].slice(-40),
    },
  });
  return {
    validation,
    simulation,
  };
}

export async function validateCinematicControlledLocalInferenceBootstrap(input?: {
  root?: string;
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
}): Promise<CinematicControlledLocalInferenceBootstrapValidation> {
  const initialization = await loadProductionMemory(input?.root);
  const record = initialization.record;
  const desiredResolution = input?.desiredResolution ?? DEFAULT_TARGET_RESOLUTION;
  const desiredDurationSeconds = input?.desiredDurationSeconds ?? DEFAULT_TARGET_DURATION_SECONDS;
  const continuityPriority = input?.continuityPriority ?? "medium";
  const loaderRegistry = buildLocalModelLoaderRegistry({
    record,
    desiredResolution,
    desiredDurationSeconds,
    continuityPriority,
  });
  const nextRecord = {
    ...record,
    local_model_loader_registry: loaderRegistry,
  };
  const readiness = summarizeLocalReadiness({
    record: nextRecord,
    desiredResolution,
    desiredDurationSeconds,
    continuityPriority,
  });
  const dryRuntimeBootstrap = await buildDryRuntimeBootstrapValidation({
    root: initialization.repoRoot,
    record: nextRecord,
    loaderRegistry,
  });
  const runtimeIntegrityValidation = await buildRuntimeIntegrityValidation({
    root: initialization.repoRoot,
    record: nextRecord,
    loaderRegistry,
    bootstrap: dryRuntimeBootstrap,
    desiredResolution,
    desiredDurationSeconds,
  });
  const executionBoundaryState = buildExecutionBoundaryState({
    record: nextRecord,
    bootstrap: dryRuntimeBootstrap,
    integrity: runtimeIntegrityValidation,
  });
  const activationReadinessScoring = buildActivationReadinessScores({
    record: nextRecord,
    readiness,
    bootstrap: dryRuntimeBootstrap,
    integrity: runtimeIntegrityValidation,
    boundary: executionBoundaryState,
    loaderRegistry,
  });
  const controlledRuntimeProfiles = buildControlledRuntimeProfiles({
    record: nextRecord,
    readiness,
    boundary: executionBoundaryState,
    integrity: runtimeIntegrityValidation,
  });
  const futureInferenceActivation = buildFutureInferenceActivationScaffold({
    boundary: executionBoundaryState,
    integrity: runtimeIntegrityValidation,
  });
  const activationAuthorityRegistry = buildActivationAuthorityRegistry({
    record: nextRecord,
    boundary: executionBoundaryState,
    integrity: runtimeIntegrityValidation,
  });
  const preInferenceGateValidation = buildPreInferenceGateValidation({
    record: nextRecord,
    readiness,
    bootstrap: dryRuntimeBootstrap,
    boundary: executionBoundaryState,
    integrity: runtimeIntegrityValidation,
    futureInferenceActivation,
  });
  const inferenceEntrySequencing = buildInferenceEntrySequencing({
    gateValidation: preInferenceGateValidation,
  });
  const forbiddenExecutionStates = buildForbiddenExecutionStateEnforcement({
    boundary: executionBoundaryState,
  });
  const governanceEscalationModeling = buildGovernanceEscalationModeling({
    record: nextRecord,
    readiness,
    integrity: runtimeIntegrityValidation,
    gateValidation: preInferenceGateValidation,
    loaderRegistry,
  });
  const futureUnlockConditions = buildFutureUnlockConditions({
    gateValidation: preInferenceGateValidation,
  });
  const dryInferenceWarmup = buildDryInferenceWarmup({
    gateValidation: preInferenceGateValidation,
    futureInferenceActivation,
    readiness,
    loaderRegistry,
  });
  const frameStageReadiness = buildFrameStageReadinessValidation({
    gateValidation: preInferenceGateValidation,
    warmup: dryInferenceWarmup,
    forbiddenExecutionStates,
    activationAuthorityRegistry,
    boundary: executionBoundaryState,
    integrity: runtimeIntegrityValidation,
    readiness,
  });
  const executionTemperatureState = buildExecutionTemperatureState({
    readiness,
    gateValidation: preInferenceGateValidation,
    frameStageReadiness,
    warmup: dryInferenceWarmup,
    boundary: executionBoundaryState,
  });
  const singleFrameExecutionPrecursor = buildSingleFrameExecutionPrecursor({
    gateValidation: preInferenceGateValidation,
    frameStageReadiness,
  });
  const warmupEscalationModeling = buildWarmupEscalationModeling({
    readiness,
    warmup: dryInferenceWarmup,
    loaderRegistry,
    frameStageReadiness,
  });
  const futureBoundedExecutionRules = buildFutureBoundedExecutionRules({
    frameStageReadiness,
    executionTemperatureState,
  });
  const dryExecutionTokenRegistry = buildDryExecutionTokenRegistry({
    activationAuthorityRegistry,
    frameStageReadiness,
    executionTemperatureState,
    boundary: executionBoundaryState,
  });
  const frameTraversalValidation = buildFrameTraversalValidation({
    tokenRegistry: dryExecutionTokenRegistry,
    activationAuthorityRegistry,
    boundary: executionBoundaryState,
    forbiddenExecutionStates,
    readiness,
    integrity: runtimeIntegrityValidation,
    warmupEscalationModeling,
  });
  const singleFrameDryExecutionPath = buildSingleFrameDryExecutionPath({
    tokenRegistry: dryExecutionTokenRegistry,
    frameTraversalValidation,
  });
  const dryExecutionRecovery = buildDryExecutionRecoveryModeling({
    tokenRegistry: dryExecutionTokenRegistry,
    traversalValidation: frameTraversalValidation,
    readiness,
    loaderRegistry,
    governanceEscalationModeling,
  });
  const futureFrameSynthesisUnlocks = buildFutureFrameSynthesisUnlocks({
    traversalValidation: frameTraversalValidation,
    tokenRegistry: dryExecutionTokenRegistry,
  });
  const executionAttemptLedger = buildExecutionAttemptLedger({
    tokenRegistry: dryExecutionTokenRegistry,
    dryExecutionPath: singleFrameDryExecutionPath,
    traversalValidation: frameTraversalValidation,
    recovery: dryExecutionRecovery,
    executionTemperatureState,
  });
  const synthesisContainmentRegistry = buildSynthesisContainmentRegistry({
    tokenRegistry: dryExecutionTokenRegistry,
    activationAuthorityRegistry,
    executionTemperatureState,
    boundary: executionBoundaryState,
  });
  const synthesisValidationLayer = buildSynthesisValidationLayer({
    containmentRegistry: synthesisContainmentRegistry,
    tokenRegistry: dryExecutionTokenRegistry,
    readiness,
    preInferenceGateValidation,
    forbiddenExecutionStates,
    runtimeIntegrityValidation,
    containedAuthorities: activationAuthorityRegistry,
    dryExecutionRecovery,
  });
  const governedSynthesisPreparation = buildGovernedSynthesisPreparationPath({
    containmentRegistry: synthesisContainmentRegistry,
    synthesisValidationLayer,
  });
  const containedEscalationModeling = buildContainedEscalationModeling({
    containmentRegistry: synthesisContainmentRegistry,
    synthesisValidationLayer,
    readiness,
    runtimeIntegrityValidation,
    governedPreparation: governedSynthesisPreparation,
  });
  const futureLowResolutionOutput = buildFutureLowResolutionOutputScaffolding({
    containmentRegistry: synthesisContainmentRegistry,
    synthesisValidationLayer,
  });
  const governedRollbackLedger = buildGovernedRollbackLedger({
    containmentRegistry: synthesisContainmentRegistry,
    governedPreparation: governedSynthesisPreparation,
    synthesisValidationLayer,
    containedEscalationModeling,
    executionTemperatureState,
  });
  const realOutputAuthorizationRegistry = buildRealOutputAuthorizationRegistry({
    activationAuthorityRegistry,
    executionTemperatureState,
    preInferenceGateValidation,
  });
  const outputContainmentValidation = buildOutputContainmentValidation({
    authorizationRegistry: realOutputAuthorizationRegistry,
    readiness,
    bootstrap: dryRuntimeBootstrap,
    forbiddenExecutionStates,
    preInferenceGateValidation,
  });
  const governedLowResolutionSandbox = await executeGovernedLowResolutionSandbox({
    root: initialization.repoRoot,
    authorizationRegistry: realOutputAuthorizationRegistry,
    outputContainmentValidation,
  });
  const firstRealSynthesisPath = buildFirstRealSynthesisPath({
    authorizationRegistry: realOutputAuthorizationRegistry,
    governedSandbox: governedLowResolutionSandbox,
    outputContainmentValidation,
  });
  const realOutputRollback = buildRealOutputRollbackLayer({
    authorizationRegistry: realOutputAuthorizationRegistry,
    governedSandbox: governedLowResolutionSandbox,
    firstRealSynthesisPath,
    outputContainmentValidation,
    executionTemperatureState,
  });
  const futureRendererEscalation = buildFutureRendererEscalationScaffolding({
    authorizationRegistry: realOutputAuthorizationRegistry,
    outputContainmentValidation,
  });
  const readinessWithPrecursor = applyGatedInferencePrecursorReadiness({
    readiness,
    activationAuthorityRegistry,
    gateValidation: preInferenceGateValidation,
    sequencing: inferenceEntrySequencing,
    escalationModeling: governanceEscalationModeling,
    futureUnlockConditions,
    executionTemperatureState,
    dryInferenceWarmup,
    singleFrameExecutionPrecursor,
    frameStageReadiness,
    warmupEscalationModeling,
    futureBoundedExecutionRules,
    dryExecutionTokenRegistry,
    singleFrameDryExecutionPath,
    frameTraversalValidation,
    dryExecutionRecovery,
    futureFrameSynthesisUnlocks,
    executionAttemptLedger,
    synthesisContainmentRegistry,
    governedSynthesisPreparation,
    synthesisValidationLayer,
    containedEscalationModeling,
    futureLowResolutionOutput,
    governedRollbackLedger,
    realOutputAuthorizationRegistry,
    governedLowResolutionSandbox,
    firstRealSynthesisPath,
    outputContainmentValidation,
    realOutputRollback,
    futureRendererEscalation,
  });
  const trackingUpdate = appendReadinessDeltaTracking({
    record: nextRecord,
    readiness: readinessWithPrecursor,
    source: "governed-low-resolution-frame-synthesis-sandbox",
  });
  await writeProductionMemoryRecord(initialization.productionMemoryPath, {
    ...trackingUpdate.record,
    activation_authority_registry: activationAuthorityRegistry,
    execution_temperature_state_history: [executionTemperatureState, ...trackingUpdate.record.execution_temperature_state_history].slice(0, 24),
    execution_boundary_status_history: [executionBoundaryState, ...trackingUpdate.record.execution_boundary_status_history].slice(0, 24),
    pre_inference_gate_validation_history: [preInferenceGateValidation, ...trackingUpdate.record.pre_inference_gate_validation_history].slice(0, 24),
    inference_entry_sequencing_history: [inferenceEntrySequencing, ...trackingUpdate.record.inference_entry_sequencing_history].slice(0, 24),
    forbidden_execution_state_history: [forbiddenExecutionStates, ...trackingUpdate.record.forbidden_execution_state_history].slice(0, 24),
    governance_escalation_modeling_history: [governanceEscalationModeling, ...trackingUpdate.record.governance_escalation_modeling_history].slice(0, 24),
    future_unlock_conditions_history: [futureUnlockConditions, ...trackingUpdate.record.future_unlock_conditions_history].slice(0, 24),
    dry_inference_warmup_history: [dryInferenceWarmup, ...trackingUpdate.record.dry_inference_warmup_history].slice(0, 24),
    single_frame_execution_precursor_history: [singleFrameExecutionPrecursor, ...trackingUpdate.record.single_frame_execution_precursor_history].slice(0, 24),
    frame_stage_readiness_history: [frameStageReadiness, ...trackingUpdate.record.frame_stage_readiness_history].slice(0, 24),
    warmup_escalation_modeling_history: [warmupEscalationModeling, ...trackingUpdate.record.warmup_escalation_modeling_history].slice(0, 24),
    future_bounded_execution_rules_history: [futureBoundedExecutionRules, ...trackingUpdate.record.future_bounded_execution_rules_history].slice(0, 24),
    dry_execution_token_registry_history: [dryExecutionTokenRegistry, ...trackingUpdate.record.dry_execution_token_registry_history].slice(0, 24),
    single_frame_dry_execution_path_history: [singleFrameDryExecutionPath, ...trackingUpdate.record.single_frame_dry_execution_path_history].slice(0, 24),
    frame_traversal_validation_history: [frameTraversalValidation, ...trackingUpdate.record.frame_traversal_validation_history].slice(0, 24),
    dry_execution_recovery_history: [dryExecutionRecovery, ...trackingUpdate.record.dry_execution_recovery_history].slice(0, 24),
    future_frame_synthesis_unlocks_history: [futureFrameSynthesisUnlocks, ...trackingUpdate.record.future_frame_synthesis_unlocks_history].slice(0, 24),
    execution_attempt_ledger_history: [executionAttemptLedger, ...trackingUpdate.record.execution_attempt_ledger_history].slice(0, 24),
    synthesis_containment_registry_history: [synthesisContainmentRegistry, ...trackingUpdate.record.synthesis_containment_registry_history].slice(0, 24),
    governed_synthesis_preparation_history: [governedSynthesisPreparation, ...trackingUpdate.record.governed_synthesis_preparation_history].slice(0, 24),
    synthesis_validation_layer_history: [synthesisValidationLayer, ...trackingUpdate.record.synthesis_validation_layer_history].slice(0, 24),
    contained_escalation_modeling_history: [containedEscalationModeling, ...trackingUpdate.record.contained_escalation_modeling_history].slice(0, 24),
    future_low_resolution_output_history: [futureLowResolutionOutput, ...trackingUpdate.record.future_low_resolution_output_history].slice(0, 24),
    governed_rollback_ledger_history: [governedRollbackLedger, ...trackingUpdate.record.governed_rollback_ledger_history].slice(0, 24),
    real_output_authorization_registry_history: [realOutputAuthorizationRegistry, ...trackingUpdate.record.real_output_authorization_registry_history].slice(0, 24),
    governed_low_resolution_sandbox_history: [governedLowResolutionSandbox, ...trackingUpdate.record.governed_low_resolution_sandbox_history].slice(0, 24),
    first_real_synthesis_path_history: [firstRealSynthesisPath, ...trackingUpdate.record.first_real_synthesis_path_history].slice(0, 24),
    output_containment_validation_history: [outputContainmentValidation, ...trackingUpdate.record.output_containment_validation_history].slice(0, 24),
    real_output_rollback_history: [realOutputRollback, ...trackingUpdate.record.real_output_rollback_history].slice(0, 24),
    future_renderer_escalation_history: [futureRendererEscalation, ...trackingUpdate.record.future_renderer_escalation_history].slice(0, 24),
  });
  return {
    readiness: readinessWithPrecursor,
    readiness_delta: trackingUpdate.tracking,
    loader_registry: loaderRegistry,
    dry_runtime_bootstrap: dryRuntimeBootstrap,
    execution_boundary_state: executionBoundaryState,
    runtime_integrity_validation: runtimeIntegrityValidation,
    activation_readiness_scores: activationReadinessScoring.scores,
    controlled_runtime_profiles: controlledRuntimeProfiles,
    future_inference_activation: futureInferenceActivation,
    activation_authority_registry: activationAuthorityRegistry,
    pre_inference_gate_validation: preInferenceGateValidation,
    inference_entry_sequencing: inferenceEntrySequencing,
    forbidden_execution_states: forbiddenExecutionStates,
    governance_escalation_modeling: governanceEscalationModeling,
    future_unlock_conditions: futureUnlockConditions,
    execution_temperature_state: executionTemperatureState,
    dry_inference_warmup: dryInferenceWarmup,
    single_frame_execution_precursor: singleFrameExecutionPrecursor,
    frame_stage_readiness: frameStageReadiness,
    warmup_escalation_modeling: warmupEscalationModeling,
    future_bounded_execution_rules: futureBoundedExecutionRules,
    dry_execution_token_registry: dryExecutionTokenRegistry,
    single_frame_dry_execution_path: singleFrameDryExecutionPath,
    frame_traversal_validation: frameTraversalValidation,
    dry_execution_recovery: dryExecutionRecovery,
    future_frame_synthesis_unlocks: futureFrameSynthesisUnlocks,
    execution_attempt_ledger: executionAttemptLedger,
    synthesis_containment_registry: synthesisContainmentRegistry,
    governed_synthesis_preparation: governedSynthesisPreparation,
    synthesis_validation_layer: synthesisValidationLayer,
    contained_escalation_modeling: containedEscalationModeling,
    future_low_resolution_output: futureLowResolutionOutput,
    governed_rollback_ledger: governedRollbackLedger,
    real_output_authorization_registry: realOutputAuthorizationRegistry,
    governed_low_resolution_sandbox: governedLowResolutionSandbox,
    first_real_synthesis_path: firstRealSynthesisPath,
    output_containment_validation: outputContainmentValidation,
    real_output_rollback: realOutputRollback,
    future_renderer_escalation: futureRendererEscalation,
    execution_enabled: false,
  };
}

export async function simulateCinematicControlledLocalInferenceBootstrap(input?: {
  root?: string;
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
}): Promise<CinematicControlledLocalInferenceBootstrapResult> {
  const validation = await validateCinematicControlledLocalInferenceBootstrap(input);
  const record = await readCinematicProductionMemory({ root: input?.root });
  const simulation: CinematicSandboxSimulationRecord = {
    simulation_id: `bootstrap-sandbox-${Date.now()}`,
    sandbox_kind: "governed-low-resolution-frame-synthesis-sandbox",
    sequence_id: "controlled-local-bootstrap-planning-only",
    routing_mode: validation.readiness.recommended_routing_mode,
    provider: "LocalFutureProvider",
    execution_enabled: false,
    queued_job_ids: validation.loader_registry.map((entry) => entry.loader_id),
    approved_job_ids: validation.loader_registry.filter((entry) => entry.status === "activation-ready").map((entry) => entry.loader_id),
    failed_job_ids: validation.runtime_integrity_validation.issues.map((entry, index) => `${entry.code}-${index + 1}`),
    retry_job_ids: validation.execution_boundary_state.current_status === "dry_initialized"
      ? []
      : validation.loader_registry.filter((entry) => entry.status !== "activation-ready").map((entry) => entry.loader_id),
    continuity_issue_count: validation.activation_readiness_scores.find((entry) => entry.dimension === "continuity-readiness")?.blockers.length ?? 0,
    asset_reuse_decisions: validation.loader_registry.map((entry) => `Keep ${entry.loader_id} inside dry bootstrap boundaries with inference and rendering disabled.`),
    loader_registry: validation.loader_registry,
    dry_runtime_bootstrap: validation.dry_runtime_bootstrap,
    execution_boundary_status: validation.execution_boundary_state,
    runtime_integrity_validation: validation.runtime_integrity_validation,
    activation_readiness_scoring: {
      recorded_at: new Date().toISOString(),
      scores: validation.activation_readiness_scores,
    },
    controlled_runtime_profiles: validation.controlled_runtime_profiles,
    future_inference_activation: validation.future_inference_activation,
    activation_authority_registry: validation.activation_authority_registry,
    pre_inference_gate_validation: validation.pre_inference_gate_validation,
    inference_entry_sequencing: validation.inference_entry_sequencing,
    forbidden_execution_states: validation.forbidden_execution_states,
    governance_escalation_modeling: validation.governance_escalation_modeling,
    future_unlock_conditions: validation.future_unlock_conditions,
    execution_temperature_state: validation.execution_temperature_state,
    dry_inference_warmup: validation.dry_inference_warmup,
    single_frame_execution_precursor: validation.single_frame_execution_precursor,
    frame_stage_readiness: validation.frame_stage_readiness,
    warmup_escalation_modeling: validation.warmup_escalation_modeling,
    future_bounded_execution_rules: validation.future_bounded_execution_rules,
    dry_execution_token_registry: validation.dry_execution_token_registry,
    single_frame_dry_execution_path: validation.single_frame_dry_execution_path,
    frame_traversal_validation: validation.frame_traversal_validation,
    dry_execution_recovery: validation.dry_execution_recovery,
    future_frame_synthesis_unlocks: validation.future_frame_synthesis_unlocks,
    execution_attempt_ledger: validation.execution_attempt_ledger,
    synthesis_containment_registry: validation.synthesis_containment_registry,
    governed_synthesis_preparation: validation.governed_synthesis_preparation,
    synthesis_validation_layer: validation.synthesis_validation_layer,
    contained_escalation_modeling: validation.contained_escalation_modeling,
    future_low_resolution_output: validation.future_low_resolution_output,
    governed_rollback_ledger: validation.governed_rollback_ledger,
    real_output_authorization_registry: validation.real_output_authorization_registry,
    governed_low_resolution_sandbox: validation.governed_low_resolution_sandbox,
    first_real_synthesis_path: validation.first_real_synthesis_path,
    output_containment_validation: validation.output_containment_validation,
    real_output_rollback: validation.real_output_rollback,
    future_renderer_escalation: validation.future_renderer_escalation,
    readiness_tracking_id: validation.readiness_delta.tracking_id,
    hybrid_escalation: null,
    recorded_at: new Date().toISOString(),
  };
  await writeCinematicProductionMemory({
    root: input?.root,
    value: {
      sandbox_simulations: [...record.sandbox_simulations, simulation].slice(-40),
      asset_reuse_decisions: [...record.asset_reuse_decisions, ...simulation.asset_reuse_decisions].slice(-40),
    },
  });
  return {
    validation,
    simulation,
  };
}

export async function estimateCinematicLocalHardware(input?: {
  root?: string;
  modelId?: string;
  hardwareProfileId?: string;
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
}): Promise<CinematicLocalHardwareEstimate | null> {
  const record = await readCinematicProductionMemory({ root: input?.root });
  const desiredResolution = input?.desiredResolution ?? DEFAULT_TARGET_RESOLUTION;
  const desiredDurationSeconds = input?.desiredDurationSeconds ?? DEFAULT_TARGET_DURATION_SECONDS;
  const preferredModel = input?.modelId
    ? record.local_model_registry.find((entry) => entry.model_id === input.modelId) ?? null
    : resolvePreferredLocalModel({
      record,
      desiredResolution,
      desiredDurationSeconds,
      continuityPriority: input?.continuityPriority ?? "medium",
    });
  if (!preferredModel) {
    return null;
  }
  const preferredHardware = input?.hardwareProfileId
    ? record.local_hardware_profiles.find((entry) => entry.profile_id === input.hardwareProfileId) ?? null
    : resolvePreferredLocalHardware({
      record,
      model: preferredModel,
      desiredResolution,
      desiredDurationSeconds,
    });
  if (!preferredHardware) {
    return null;
  }
  const preferredRuntime = resolvePreferredLocalRuntime({ record, hardware: preferredHardware });
  return buildLocalHardwareEstimate({
    model: preferredModel,
    runtime: preferredRuntime,
    hardware: preferredHardware,
    desiredResolution,
    desiredDurationSeconds,
  });
}

export async function planCinematicLocalProviderRouting(input?: {
  root?: string;
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
  requireOfflinePlanning?: boolean;
}): Promise<CinematicLocalProviderRoutingPlan> {
  const record = await readCinematicProductionMemory({ root: input?.root });
  const readiness = summarizeLocalReadiness({
    record,
    desiredResolution: input?.desiredResolution ?? DEFAULT_TARGET_RESOLUTION,
    desiredDurationSeconds: input?.desiredDurationSeconds ?? DEFAULT_TARGET_DURATION_SECONDS,
    continuityPriority: input?.continuityPriority ?? "medium",
  });
  const fallbackProvider: Exclude<CinematicGenerationProvider, "LocalFutureProvider"> = input?.continuityPriority === "high"
    ? "Sora"
    : input?.desiredDurationSeconds && input.desiredDurationSeconds <= 8
      ? "Seedance"
      : "Veo";
  const offline = Boolean(input?.requireOfflinePlanning);
  const hybridStrategyIds = selectHybridStrategyIds({
    record,
    readiness,
    continuityPriority: input?.continuityPriority ?? "medium",
    desiredDurationSeconds: input?.desiredDurationSeconds ?? DEFAULT_TARGET_DURATION_SECONDS,
    offline,
  });
  const selectedProvider = offline || readiness.local_provider_available ? "LocalFutureProvider" : fallbackProvider;
  const routingMode: CinematicProviderRoutingMode = offline
    ? "offline-planning-mode"
    : readiness.local_provider_available
      ? "future-local-inference-mode"
      : fallbackProvider === "Seedance"
        ? "cheap-draft-provider"
        : fallbackProvider === "Sora"
          ? "premium-cinematic-provider"
          : "balanced-comparison-mode";
  const reasons = offline
    ? [
      "Offline planning was explicitly requested.",
      ...record.local_provider_routing_rules,
    ]
    : readiness.local_provider_available
      ? [
        "Local model/runtime/hardware tuple is sufficiently prepared for future manual bridge review.",
        ...record.local_provider_routing_rules,
      ]
      : [
        ...readiness.blocked_reasons,
        `Fallback provider ${fallbackProvider} remains the safer near-term advisory route.`,
      ];
  return {
    selected_provider: selectedProvider,
    routing_mode: routingMode,
    local_provider_ready: readiness.local_provider_available,
    fallback_provider: fallbackProvider,
    recommended_model_id: readiness.preferred_model_id,
    recommended_runtime_id: readiness.preferred_runtime_id,
    recommended_hardware_profile_id: readiness.preferred_hardware_profile_id,
    reasons,
    cache_strategy: record.local_asset_cache_strategy,
    governance_requirements: record.local_inference_governance_rules,
    hybrid_strategy_ids: hybridStrategyIds,
  };
}

export async function planCinematicHybridLocalCloudStrategy(input?: {
  root?: string;
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
  requireOfflinePlanning?: boolean;
}): Promise<CinematicHybridRoutingStrategyPlan> {
  const routing = await planCinematicLocalProviderRouting(input);
  const readiness = await assessCinematicLocalInferenceReadiness(input);
  return {
    selected_strategy_id: routing.hybrid_strategy_ids[0] ?? null,
    routing_mode: routing.routing_mode,
    fallback_provider: routing.fallback_provider,
    reasons: uniqueNormalizedStrings([
      ...routing.reasons,
      ...routing.governance_requirements,
    ]),
    candidate_strategy_ids: routing.hybrid_strategy_ids,
    milestone_progress: readiness.milestone_progress,
  };
}

export async function buildCinematicLocalExecutionPlan(input?: {
  root?: string;
  sequenceId?: string;
  jobIds?: string[];
  desiredResolution?: CinematicVideoResolution;
  desiredDurationSeconds?: number;
  continuityPriority?: "low" | "medium" | "high";
}): Promise<CinematicLocalExecutionPlan> {
  const record = await readCinematicProductionMemory({ root: input?.root });
  const readiness = summarizeLocalReadiness({
    record,
    desiredResolution: input?.desiredResolution ?? DEFAULT_TARGET_RESOLUTION,
    desiredDurationSeconds: input?.desiredDurationSeconds ?? DEFAULT_TARGET_DURATION_SECONDS,
    continuityPriority: input?.continuityPriority ?? "medium",
  });
  const routing = await planCinematicLocalProviderRouting(input);
  const plannedJobIds = input?.jobIds
    ?? (input?.sequenceId
      ? record.generation_jobs.filter((entry) => entry.sequence_id === input.sequenceId).map((entry) => entry.job_id)
      : []);
  const hardwareEstimate = readiness.preferred_model_id && readiness.preferred_hardware_profile_id
    ? await estimateCinematicLocalHardware({
      root: input?.root,
      modelId: readiness.preferred_model_id,
      hardwareProfileId: readiness.preferred_hardware_profile_id,
      desiredResolution: input?.desiredResolution,
      desiredDurationSeconds: input?.desiredDurationSeconds,
      continuityPriority: input?.continuityPriority,
    })
    : null;
  return {
    planned_job_ids: plannedJobIds,
    routing,
    readiness,
    hardware_estimate: hardwareEstimate,
    manual_execution_only: true,
    execution_enabled: false,
    steps: [
      "Review the preferred local model, runtime, and hardware tuple with an operator before any bridge work.",
      "Keep sandbox-only mode enabled while local runtime detection and cache layout stay advisory.",
      "Prepare LocalFutureProvider payloads and asset references without launching a runtime or downloading models.",
      "Confirm cache directories, weight storage, and reference assets as a separate manual operational task.",
      "Record and review runtime probe snapshots before trusting any local runtime readiness signal.",
      "If future policy changes permit it, introduce a separate manual-only local execution bridge rather than widening this readiness layer.",
    ],
    blocked_reasons: readiness.blocked_reasons,
    milestone_progress: readiness.milestone_progress,
  };
}

export function selectCinematicGenerationProviderRoute(input: {
  routingMode: CinematicProviderRoutingMode;
}): CinematicProviderRoutingDecision {
  switch (input.routingMode) {
    case "cheap-draft-provider":
      return {
        provider: "Seedance",
        routing_mode: input.routingMode,
        rationale: "Cheap draft provider selected for bounded sandbox framing passes.",
        estimated_cost_tier: "low",
      };
    case "premium-cinematic-provider":
      return {
        provider: "Sora",
        routing_mode: input.routingMode,
        rationale: "Premium cinematic provider selected for higher-fidelity provider-ready planning.",
        estimated_cost_tier: "high",
      };
    case "offline-planning-mode":
      return {
        provider: "LocalFutureProvider",
        routing_mode: input.routingMode,
        rationale: "Offline planning mode selected to keep orchestration validation provider-agnostic and non-executing.",
        estimated_cost_tier: "low",
      };
    case "future-local-inference-mode":
      return {
        provider: "LocalFutureProvider",
        routing_mode: input.routingMode,
        rationale: "Future local inference mode selected to preserve a generator-agnostic local routing path.",
        estimated_cost_tier: "medium",
      };
    case "balanced-comparison-mode":
      return {
        provider: "Veo",
        routing_mode: input.routingMode,
        rationale: "Balanced comparison mode selected for provider output comparison without hard-locking execution.",
        estimated_cost_tier: "medium",
      };
  }
}

export async function validateCinematicExecutionPlan(input: {
  root?: string;
  sequenceId: string;
  shotIds?: string[];
  isolateRegenerationOnly?: boolean;
}): Promise<CinematicExecutionValidationResult> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const sequence = record.scene_sequences.find((entry) => entry.sequence_id === input.sequenceId);
  if (!sequence) {
    throw new Error(`Unknown cinematic sequence id: ${input.sequenceId}`);
  }

  const continuity = await validateCinematicSequenceContinuity({ root: input.root, sequenceId: input.sequenceId });
  const issues: CinematicExecutionValidationIssue[] = continuity.mismatches.map((entry) => ({
    category: "continuity-compatibility",
    shot_id: entry.shot_id,
    detail: entry.detail,
  }));
  const sortedShots = [...sequence.shots].sort((left, right) => left.shot_order - right.shot_order);
  const successfulShotIds = new Set(record.successful_generations.map((entry) => entry.shot_id));
  const requestedShotIds = input.shotIds ?? sortedShots.map((entry) => entry.shot_id);
  const requestedShots = sortedShots.filter((entry) => requestedShotIds.includes(entry.shot_id));
  const requestOrder = requestedShotIds
    .map((shotId) => sequence.shots.find((entry) => entry.shot_id === shotId)?.shot_order ?? Number.NaN)
    .filter((value) => Number.isFinite(value));
  if (requestOrder.some((value, index) => index > 0 && value < requestOrder[index - 1]!)) {
    issues.push({
      category: "invalid-shot-ordering",
      detail: "Requested shot ordering is not monotonic with the stored sequence order.",
    });
  }

  for (const shot of requestedShots) {
    const dependencyShotIds = resolveExecutionDependencyShotIds(sequence, shot);
    for (const dependencyShotId of dependencyShotIds) {
      if (!requestedShotIds.includes(dependencyShotId) && !successfulShotIds.has(dependencyShotId)) {
        issues.push({
          category: "missing-dependencies",
          shot_id: shot.shot_id,
          detail: `Shot depends on ${dependencyShotId} but that dependency is neither selected nor already successful.`,
        });
      }
    }
    for (const assetId of shot.required_assets) {
      if (!record.generated_assets.some((entry) => entry.asset_id === assetId)) {
        issues.push({
          category: "stale-asset-references",
          shot_id: shot.shot_id,
          detail: `Shot references stale asset ${assetId}.`,
        });
      }
    }
    const highestRetryCount = record.generation_jobs
      .filter((entry) => entry.sequence_id === sequence.sequence_id && entry.shot_id === shot.shot_id)
      .reduce((maxRetryCount, entry) => Math.max(maxRetryCount, entry.retry_count), 0);
    if (highestRetryCount >= MAX_GENERATION_RETRY_COUNT) {
      issues.push({
        category: "retry-loop",
        shot_id: shot.shot_id,
        detail: `Shot exceeded the bounded retry threshold of ${MAX_GENERATION_RETRY_COUNT}.`,
      });
    }
  }

  return {
    sequence_id: sequence.sequence_id,
    valid: issues.length === 0,
    issues,
  };
}

export async function compileCinematicProviderPayload(input: {
  root?: string;
  jobId: string;
  provider?: CinematicGenerationProvider;
  targetDurationSeconds?: number;
  targetResolution?: CinematicVideoResolution;
  targetFrameRate?: number;
  imageReferenceAssetIds?: string[];
}): Promise<CinematicProviderPayload> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const { job, shot, beat } = resolveJobContext(record, input.jobId);
  const provider = input.provider ?? job.provider;
  const capability = resolveProviderCapability(record, provider);
  const durationSeconds = input.targetDurationSeconds ?? Math.min(DEFAULT_TARGET_DURATION_SECONDS, capability.max_duration_seconds);
  const resolution = input.targetResolution ?? DEFAULT_TARGET_RESOLUTION;
  const frameRate = input.targetFrameRate ?? DEFAULT_TARGET_FRAME_RATE;
  const assetReferences = input.imageReferenceAssetIds ?? job.prompt_payload.asset_reuse_candidates.slice(0, capability.max_image_references);
  const continuityContext = [
    ...job.continuity_context.continuity_constraints,
    `Dependency shots: ${job.continuity_context.dependency_shot_ids.join(", ") || "none"}`,
    `Beat goal: ${beat.emotional_goal}`,
  ];
  const cameraInstructions = [
    shot.camera_behavior,
    shot.transition_notes,
    `Timeline position ${shot.timeline_position}`,
  ];
  const styleGuidance = [
    ...record.visual_style,
    `Tone: ${shot.tone_reference}`,
    `Lighting: ${shot.lighting_reference}`,
  ];
  const normalized = normalizePromptForProvider({
    provider,
    capability,
    prompt: job.prompt_payload.compiled_prompt,
    continuityContext,
    cameraInstructions,
    styleGuidance,
  });

  return {
    job_id: job.job_id,
    provider,
    normalized_prompt: normalized.normalized_prompt,
    continuity_context: continuityContext,
    shot_references: [shot.shot_id, ...job.continuity_context.dependency_shot_ids],
    asset_references: assetReferences,
    camera_instructions: cameraInstructions,
    duration_seconds: durationSeconds,
    resolution,
    frame_rate: frameRate,
    style_guidance: styleGuidance,
    retry_metadata: [
      `retry_count=${job.retry_count}`,
      `retry_recommendation=${capability.retry_recommendation}`,
      `queue_behavior=${capability.queue_behavior}`,
    ],
    provider_payload: getProviderPayloadShape({
      provider,
      normalizedPrompt: normalized.normalized_prompt,
      durationSeconds,
      resolution,
      frameRate,
      references: assetReferences,
      cameraInstructions,
    }),
  };
}

function describeContinuityPreservation(input: {
  capability: CinematicProviderCapability;
  payload: CinematicProviderPayload;
}): string {
  if (input.capability.continuity_support === "full") {
    return `Full continuity preserved across ${input.payload.shot_references.length} shot reference(s).`;
  }
  if (input.capability.continuity_support === "partial") {
    return `Continuity must be condensed to the highest-signal ${Math.min(3, input.payload.continuity_context.length)} reference(s).`;
  }
  return "Continuity references need manual reduction before any real submission handoff.";
}

function estimateProviderQueueMinutes(input: {
  provider: CinematicGenerationProvider;
  issueCount: number;
  escalationCount: number;
}): number {
  const baseMinutes = (() => {
    switch (input.provider) {
      case "Seedance":
        return 8;
      case "Runway":
        return 18;
      case "Veo":
        return 28;
      case "Sora":
        return 45;
      case "LocalFutureProvider":
        return 5;
    }
  })();
  return baseMinutes + (input.issueCount * 6) + (input.escalationCount * 4);
}

function extendProviderConstraintIssues(input: {
  capability: CinematicProviderCapability;
  payload: CinematicProviderPayload;
  issues: CinematicProviderPayloadValidationIssue[];
}): CinematicProviderPayloadValidationIssue[] {
  const nextIssues = [...input.issues];
  const pushIssue = (issue: CinematicProviderPayloadValidationIssue): void => {
    if (!nextIssues.some((entry) => entry.category === issue.category && entry.detail === issue.detail)) {
      nextIssues.push(issue);
    }
  };

  if (input.capability.provider === "Seedance" && input.payload.resolution === "1080p" && input.payload.frame_rate === 30 && input.payload.duration_seconds > 6) {
    pushIssue({
      category: "provider-specific-restriction",
      detail: "Seedance dry-run rejects 1080p at 30fps when duration exceeds 6 seconds.",
    });
  }
  if (input.capability.provider === "Runway" && input.payload.resolution === "1080p" && input.payload.frame_rate === 30) {
    pushIssue({
      category: "provider-specific-restriction",
      detail: "Runway dry-run rejects the 1080p/30fps combination for this bridge profile.",
    });
  }
  if (input.capability.provider === "Veo" && input.payload.frame_rate === 30 && input.payload.duration_seconds > 10) {
    pushIssue({
      category: "provider-specific-restriction",
      detail: "Veo dry-run rejects 30fps requests when duration exceeds 10 seconds.",
    });
  }
  if (input.capability.continuity_support !== "full" && input.payload.shot_references.length > 4) {
    pushIssue({
      category: "continuity-incompatibility",
      detail: `${input.capability.provider} cannot accept the current number of continuity shot references without manual reduction.`,
    });
  }

  return nextIssues;
}

export async function compileCinematicProviderPayloadVariants(input: {
  root?: string;
  jobId: string;
  targetDurationSeconds?: number;
  targetResolution?: CinematicVideoResolution;
  targetFrameRate?: number;
  imageReferenceAssetIds?: string[];
}): Promise<CinematicProviderPayload[]> {
  const record = await readCinematicProductionMemory({ root: input.root });
  return Promise.all(record.provider_capability_registry.map((entry) => compileCinematicProviderPayload({
    ...input,
    provider: entry.provider,
  })));
}

export async function validateCinematicProviderPayload(input: {
  root?: string;
  payload: CinematicProviderPayload;
}): Promise<CinematicProviderPayloadValidationResult> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const capability = resolveProviderCapability(record, input.payload.provider);
  const issues: CinematicProviderPayloadValidationIssue[] = [];

  if (input.payload.normalized_prompt.length > capability.max_prompt_characters) {
    issues.push({
      category: "overlong-prompt",
      detail: `Prompt exceeds ${capability.max_prompt_characters} characters for ${capability.provider}.`,
    });
  }
  if (input.payload.duration_seconds > capability.max_duration_seconds) {
    issues.push({
      category: "unsupported-duration",
      detail: `Duration ${input.payload.duration_seconds}s exceeds ${capability.max_duration_seconds}s for ${capability.provider}.`,
    });
  }
  if (!capability.supported_resolutions.includes(input.payload.resolution)) {
    issues.push({
      category: "unsupported-resolution",
      detail: `Resolution ${input.payload.resolution} is not supported by ${capability.provider}.`,
    });
  }
  if (!capability.supported_frame_rates.includes(input.payload.frame_rate)) {
    issues.push({
      category: "unsupported-frame-rate",
      detail: `Frame rate ${input.payload.frame_rate} is not supported by ${capability.provider}.`,
    });
  }
  if (!capability.image_reference_support && input.payload.asset_references.length > 0) {
    issues.push({
      category: "invalid-reference-count",
      detail: `${capability.provider} does not support image references.`,
    });
  }
  if (input.payload.asset_references.length > capability.max_image_references) {
    issues.push({
      category: "invalid-reference-count",
      detail: `${capability.provider} supports only ${capability.max_image_references} image references.`,
    });
  }
  if (capability.continuity_support === "limited" && input.payload.continuity_context.length > 4) {
    issues.push({
      category: "continuity-incompatibility",
      detail: `${capability.provider} cannot safely carry the current continuity burden without simplification.`,
    });
  }
  if (capability.provider === "Seedance" && input.payload.style_guidance.length > 6) {
    issues.push({
      category: "provider-specific-restriction",
      detail: "Seedance payloads should stay compressed and cannot carry excessive style guidance.",
    });
  }
  if (capability.provider === "Runway" && input.payload.duration_seconds > 10) {
    issues.push({
      category: "provider-specific-restriction",
      detail: "Runway planning payloads in this bridge are capped at 10 seconds.",
    });
  }

  const finalIssues = extendProviderConstraintIssues({
    capability,
    payload: input.payload,
    issues,
  });

  return {
    provider: capability.provider,
    valid: finalIssues.length === 0,
    issues: finalIssues,
  };
}

export async function exportCinematicRealProviderPayloads(input: {
  root?: string;
  jobIds: string[];
  provider?: CinematicGenerationProvider;
  targetDurationSeconds?: number;
  targetResolution?: CinematicVideoResolution;
  targetFrameRate?: number;
  imageReferenceAssetIds?: string[];
}): Promise<CinematicRealProviderPayloadExport[]> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const jobs = resolveKnownGenerationJobs(record, input.jobIds);
  return Promise.all(jobs.map(async (job) => {
    const payload = await compileCinematicProviderPayload({
      root: input.root,
      jobId: job.job_id,
      provider: input.provider ?? job.provider,
      targetDurationSeconds: input.targetDurationSeconds,
      targetResolution: input.targetResolution,
      targetFrameRate: input.targetFrameRate,
      imageReferenceAssetIds: input.imageReferenceAssetIds,
    });
    return {
      job_id: job.job_id,
      provider: payload.provider,
      sequence_id: job.sequence_id,
      shot_id: job.shot_id,
      normalized_prompt: payload.normalized_prompt,
      provider_ready_json: JSON.stringify(payload.provider_payload, null, 2),
      continuity_references: payload.continuity_context,
      shot_references: payload.shot_references,
      asset_references: payload.asset_references,
      retry_metadata: payload.retry_metadata,
      estimated_cost: job.estimated_cost,
      execution_notes: [...job.prompt_payload.execution_notes],
    } satisfies CinematicRealProviderPayloadExport;
  }));
}

export async function evaluateCinematicApprovalEscalation(input: {
  root?: string;
  jobIds: string[];
  provider?: CinematicGenerationProvider;
  costThreshold?: number;
  retryThreshold?: number;
  largeBatchThreshold?: number;
}): Promise<CinematicApprovalEscalationReport> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const jobs = resolveKnownGenerationJobs(record, input.jobIds);
  const { provider: sharedProvider, sequenceId } = resolveSharedJobContext(jobs);
  const provider = input.provider ?? sharedProvider;
  const capability = resolveProviderCapability(record, provider);
  const costThreshold = input.costThreshold ?? Math.floor(record.generation_budget_policy.max_estimated_sequence_cost * 0.5);
  const retryThreshold = input.retryThreshold ?? Math.max(1, record.generation_budget_policy.max_retries_per_job - 1);
  const largeBatchThreshold = input.largeBatchThreshold ?? Math.max(4, Math.ceil(record.generation_budget_policy.max_shots_per_batch * 0.75));
  const totalEstimatedCost = jobs.reduce((sum, entry) => sum + entry.estimated_cost, 0);
  const continuityBurden = jobs.reduce((maxCount, entry) => Math.max(maxCount, entry.continuity_context.dependency_shot_ids.length + entry.continuity_context.preserved_output_refs.length), 0);
  const reasons: CinematicApprovalEscalationReason[] = [];

  if (totalEstimatedCost > costThreshold) {
    reasons.push({
      code: "cost-threshold",
      severity: "critical",
      detail: `Estimated cost ${totalEstimatedCost} exceeds escalation threshold ${costThreshold}.`,
    });
  }
  if (jobs.some((entry) => entry.retry_count >= retryThreshold)) {
    reasons.push({
      code: "retry-threshold",
      severity: "warning",
      detail: `Retry count reached escalation threshold ${retryThreshold}.`,
    });
  }
  if (capability.continuity_support !== "full" && continuityBurden > 2) {
    reasons.push({
      code: "continuity-risk",
      severity: "critical",
      detail: `${provider} has ${capability.continuity_support} continuity support while current dependency burden is ${continuityBurden}.`,
    });
  }
  if (capability.estimated_cost_profile.premium >= 12 || provider === "Sora" || provider === "Veo") {
    reasons.push({
      code: "premium-provider",
      severity: "warning",
      detail: `${provider} is classified as a premium-provider handoff and requires extra approval review.`,
    });
  }
  if (jobs.length >= largeBatchThreshold) {
    reasons.push({
      code: "large-batch",
      severity: "warning",
      detail: `Requested batch size ${jobs.length} exceeds escalation threshold ${largeBatchThreshold}.`,
    });
  }

  return {
    provider,
    sequence_id: sequenceId,
    job_ids: input.jobIds,
    requires_additional_approval: reasons.length > 0,
    cost_threshold: costThreshold,
    retry_threshold: retryThreshold,
    large_batch_threshold: largeBatchThreshold,
    reasons,
  };
}

function resolveFallbackRetryRoute(input: {
  comparisons: CinematicProviderReadinessComparison[];
  currentProvider: CinematicGenerationProvider;
}): string {
  const fallback = input.comparisons.find((entry) => entry.provider !== input.currentProvider && entry.valid);
  if (fallback) {
    return `Manual retry route: switch to ${fallback.provider} after operator review.`;
  }
  return "Manual retry route: simplify prompt or references before re-exporting.";
}

function describeQualityProfile(capability: CinematicProviderCapability): string {
  if (capability.continuity_support === "full" && capability.estimated_cost_profile.premium >= 12) {
    return "premium cinematic continuity";
  }
  if (capability.continuity_support === "partial") {
    return "balanced comparison profile";
  }
  return "offline bridge rehearsal";
}

export async function compareCinematicProviderReadiness(input: {
  root?: string;
  jobIds: string[];
  targetDurationSeconds?: number;
  targetResolution?: CinematicVideoResolution;
  targetFrameRate?: number;
  imageReferenceAssetIds?: string[];
}): Promise<CinematicProviderReadinessComparison[]> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const jobs = resolveKnownGenerationJobs(record, input.jobIds);

  const comparisons = await Promise.all(record.provider_capability_registry.map(async (capability) => {
    const payloads = await Promise.all(jobs.map((job) => compileCinematicProviderPayload({
      root: input.root,
      jobId: job.job_id,
      provider: capability.provider,
      targetDurationSeconds: input.targetDurationSeconds,
      targetResolution: input.targetResolution,
      targetFrameRate: input.targetFrameRate,
      imageReferenceAssetIds: input.imageReferenceAssetIds,
    })));
    const validationResults = await Promise.all(payloads.map((payload) => validateCinematicProviderPayload({
      root: input.root,
      payload,
    })));
    const issues = validationResults.flatMap((entry) => entry.issues.map((issue) => issue.detail));
    const valid = validationResults.every((entry) => entry.valid);
    return {
      provider: capability.provider,
      estimated_cost: capability.estimated_cost_profile.standard * jobs.length,
      duration_support: `up to ${capability.max_duration_seconds}s`,
      continuity_support: capability.continuity_support,
      retry_tolerance: `${record.generation_budget_policy.max_retries_per_job} bounded retries | ${capability.retry_recommendation}`,
      quality_profile: describeQualityProfile(capability),
      queue_behavior: capability.queue_behavior,
      expected_risk: issues.length > 0 ? "high" : capability.continuity_support === "full" ? "low" : "medium",
      valid,
      issues,
    } satisfies CinematicProviderReadinessComparison;
  }));

  return comparisons.sort((left, right) => left.provider.localeCompare(right.provider));
}

export async function previewCinematicRealProviderDryRun(input: {
  root?: string;
  jobIds: string[];
  provider?: CinematicGenerationProvider;
  approvalTokenId?: string;
  operatorId?: string;
  targetDurationSeconds?: number;
  targetResolution?: CinematicVideoResolution;
  targetFrameRate?: number;
  imageReferenceAssetIds?: string[];
  persist?: boolean;
}): Promise<CinematicRealProviderDryRunResult> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const jobs = resolveKnownGenerationJobs(record, input.jobIds);
  const { provider: sharedProvider, sequenceId } = resolveSharedJobContext(jobs);
  const provider = input.provider ?? sharedProvider;
  const capability = resolveProviderCapability(record, provider);
  const payloadExports = await exportCinematicRealProviderPayloads({
    root: input.root,
    jobIds: input.jobIds,
    provider,
    targetDurationSeconds: input.targetDurationSeconds,
    targetResolution: input.targetResolution,
    targetFrameRate: input.targetFrameRate,
    imageReferenceAssetIds: input.imageReferenceAssetIds,
  });
  const comparisons = await compareCinematicProviderReadiness({
    root: input.root,
    jobIds: input.jobIds,
    targetDurationSeconds: input.targetDurationSeconds,
    targetResolution: input.targetResolution,
    targetFrameRate: input.targetFrameRate,
    imageReferenceAssetIds: input.imageReferenceAssetIds,
  });
  const escalation = await evaluateCinematicApprovalEscalation({
    root: input.root,
    jobIds: input.jobIds,
    provider,
  });

  const constraintResults = await Promise.all(payloadExports.map(async (payloadExport) => {
    const payload = await compileCinematicProviderPayload({
      root: input.root,
      jobId: payloadExport.job_id,
      provider,
      targetDurationSeconds: input.targetDurationSeconds,
      targetResolution: input.targetResolution,
      targetFrameRate: input.targetFrameRate,
      imageReferenceAssetIds: input.imageReferenceAssetIds,
    });
    const validation = await validateCinematicProviderPayload({ root: input.root, payload });
    const estimatedQueueMinutes = estimateProviderQueueMinutes({
      provider,
      issueCount: validation.issues.length,
      escalationCount: escalation.reasons.length,
    });
    const relatedJob = jobs.find((entry) => entry.job_id === payloadExport.job_id)!;
    return {
      job_id: payloadExport.job_id,
      provider,
      provider_response: validation.valid ? "accepted-dry-run" : "rejected-dry-run",
      accepted: validation.valid,
      estimated_queue_minutes: estimatedQueueMinutes,
      estimated_cost_impact: validation.valid ? relatedJob.estimated_cost : Math.max(1, Math.floor(relatedJob.estimated_cost / 2)),
      retry_routing: validation.valid
        ? `If validation drifts, retry once via ${provider} with reduced style guidance.`
        : resolveFallbackRetryRoute({ comparisons, currentProvider: provider }),
      continuity_preservation: describeContinuityPreservation({ capability, payload }),
      issues: validation.issues,
    } satisfies CinematicProviderDryRunConstraintResult;
  }));

  const preview: CinematicRealProviderDryRunPreview = {
    provider,
    sequence_id: sequenceId,
    job_ids: input.jobIds,
    payload_exports: payloadExports,
    constraint_results: constraintResults,
    provider_acceptance: constraintResults.every((entry) => entry.accepted),
    estimated_total_queue_minutes: Math.max(0, ...constraintResults.map((entry) => entry.estimated_queue_minutes)),
    estimated_total_cost_impact: constraintResults.reduce((sum, entry) => sum + entry.estimated_cost_impact, 0),
    retry_routing_summary: constraintResults.map((entry) => `${entry.job_id}: ${entry.retry_routing}`),
    continuity_preservation_summary: constraintResults.map((entry) => `${entry.job_id}: ${entry.continuity_preservation}`),
    additional_approval_required: escalation.requires_additional_approval,
    escalation,
  };

  const auditEntries = input.operatorId ? [buildApprovalAuditEntry({
    record,
    action: "preview-real-provider-dry-run",
    operatorId: input.operatorId,
    provider,
    sequenceId,
    jobIds: input.jobIds,
    detail: `Prepared real-provider dry-run preview with ${constraintResults.filter((entry) => entry.accepted).length}/${constraintResults.length} accepted payload(s).`,
    approvalTokenId: input.approvalTokenId ?? null,
  })] : [];

  if (input.persist === false || auditEntries.length === 0) {
    return {
      preview,
      audit_entries: auditEntries,
      persisted: false,
    };
  }

  await writeCinematicProductionMemory({
    root: input.root,
    value: {
      approval_audit_trail: [...record.approval_audit_trail, ...auditEntries],
    },
  });
  return {
    preview,
    audit_entries: auditEntries,
    persisted: true,
  };
}

export async function buildCinematicSubmissionPackage(input: {
  root?: string;
  jobIds: string[];
  provider?: CinematicGenerationProvider;
  approvalTokenId?: string;
  operatorId?: string;
  targetDurationSeconds?: number;
  targetResolution?: CinematicVideoResolution;
  targetFrameRate?: number;
  imageReferenceAssetIds?: string[];
  persist?: boolean;
}): Promise<CinematicSubmissionPackageResult> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const jobs = resolveKnownGenerationJobs(record, input.jobIds);
  const { provider: sharedProvider, sequenceId } = resolveSharedJobContext(jobs);
  const provider = input.provider ?? sharedProvider;
  const sequence = record.scene_sequences.find((entry) => entry.sequence_id === sequenceId);
  if (!sequence) {
    throw new Error(`Unknown cinematic sequence id: ${sequenceId}`);
  }
  const capability = resolveProviderCapability(record, provider);
  const dryRun = await previewCinematicRealProviderDryRun({
    root: input.root,
    jobIds: input.jobIds,
    provider,
    approvalTokenId: input.approvalTokenId,
    targetDurationSeconds: input.targetDurationSeconds,
    targetResolution: input.targetResolution,
    targetFrameRate: input.targetFrameRate,
    imageReferenceAssetIds: input.imageReferenceAssetIds,
    persist: false,
  });
  const readiness = await validateCinematicExecutionReadiness({
    root: input.root,
    jobIds: input.jobIds,
    approvalTokenId: input.approvalTokenId,
  });
  const approvalToken = resolveApprovalToken(record, input.approvalTokenId ?? jobs[0]?.approval_token_id ?? undefined);
  const auditReferences = record.approval_audit_trail
    .filter((entry) => entry.sequence_id === sequenceId && entry.provider === provider)
    .slice(-10)
    .map((entry) => `${entry.append_only_index}. ${entry.audit_id}`);

  const submissionPackage: CinematicSubmissionPackage = {
    provider,
    sequence_id: sequenceId,
    job_ids: input.jobIds,
    sequence_package: {
      sequence_id: sequence.sequence_id,
      title: sequence.title,
      beat_id: sequence.beat_id,
      provider,
      shot_ids: jobs.map((entry) => entry.shot_id),
      job_ids: input.jobIds,
      total_estimated_cost: jobs.reduce((sum, entry) => sum + entry.estimated_cost, 0),
    },
    shot_package: jobs.map((job) => ({
      shot_id: job.shot_id,
      job_id: job.job_id,
      prompt_summary: job.prompt_payload.compiled_prompt.slice(0, 160),
      continuity_dependencies: [...job.continuity_context.dependency_shot_ids],
      asset_references: dryRun.preview.payload_exports.find((entry) => entry.job_id === job.job_id)?.asset_references ?? [],
      retry_count: job.retry_count,
      estimated_cost: job.estimated_cost,
    })),
    provider_package: {
      provider,
      queue_behavior: capability.queue_behavior,
      retry_recommendation: capability.retry_recommendation,
      payload_exports: dryRun.preview.payload_exports,
    },
    execution_manifest: {
      manual_execution_only: true,
      ready_for_manual_submission: dryRun.preview.provider_acceptance && readiness.approval_token_valid && !dryRun.preview.additional_approval_required,
      estimated_total_queue_minutes: dryRun.preview.estimated_total_queue_minutes,
      estimated_total_cost_impact: dryRun.preview.estimated_total_cost_impact,
      blocked_reasons: [
        ...readiness.blocked_reasons,
        ...dryRun.preview.escalation.reasons.map((entry) => entry.detail),
      ],
      continuity_preservation_summary: dryRun.preview.continuity_preservation_summary,
    },
    operator_approval_manifest: {
      manual_approval_required: record.generation_budget_policy.manual_approval_required,
      approval_token_id: approvalToken?.token_id ?? null,
      approval_token_valid: readiness.approval_token_valid,
      additional_approval_required: dryRun.preview.additional_approval_required,
      escalation_reasons: dryRun.preview.escalation.reasons.map((entry) => entry.detail),
      blocked_reasons: readiness.blocked_reasons,
    },
    audit_references: auditReferences,
    package_json: "",
  };
  submissionPackage.package_json = JSON.stringify(submissionPackage, null, 2);

  const auditEntries = input.operatorId ? [buildApprovalAuditEntry({
    record,
    action: "export-submission-package",
    operatorId: input.operatorId,
    provider,
    sequenceId,
    jobIds: input.jobIds,
    detail: `Prepared manual submission package for ${input.jobIds.length} job(s).`,
    approvalTokenId: input.approvalTokenId ?? approvalToken?.token_id ?? null,
  })] : [];

  if (input.persist === false || auditEntries.length === 0) {
    return {
      submission_package: submissionPackage,
      audit_entries: auditEntries,
      persisted: false,
    };
  }

  await writeCinematicProductionMemory({
    root: input.root,
    value: {
      approval_audit_trail: [...record.approval_audit_trail, ...auditEntries],
    },
  });
  return {
    submission_package: submissionPackage,
    audit_entries: auditEntries,
    persisted: true,
  };
}

export async function forecastCinematicSequenceCost(input: {
  root?: string;
  sequenceId: string;
  routingMode: CinematicProviderRoutingMode;
}): Promise<CinematicCostForecast> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const sequence = record.scene_sequences.find((entry) => entry.sequence_id === input.sequenceId);
  if (!sequence) {
    throw new Error(`Unknown cinematic sequence id: ${input.sequenceId}`);
  }
  const routing = selectCinematicGenerationProviderRoute({ routingMode: input.routingMode });
  const targetCapability = resolveProviderCapability(record, routing.provider);
  const providerForeasts = record.provider_capability_registry.map((entry) => ({
    provider: entry.provider,
    draft_cost: entry.estimated_cost_profile.draft * sequence.shots.length,
    standard_cost: entry.estimated_cost_profile.standard * sequence.shots.length,
    premium_cost: entry.estimated_cost_profile.premium * sequence.shots.length,
  }));
  const forecastCost = getEstimatedProviderCost(targetCapability, getRoutingModeCostTier(input.routingMode)) * sequence.shots.length;
  const retryCost = targetCapability.estimated_cost_profile.draft * Math.min(sequence.shots.length, MAX_GENERATION_RETRY_COUNT);
  const standardCosts = providerForeasts.map((entry) => entry.standard_cost);
  const providerVariance = Math.max(...standardCosts) - Math.min(...standardCosts);

  return {
    sequence_id: sequence.sequence_id,
    provider: targetCapability.provider,
    estimated_sequence_cost: forecastCost,
    estimated_retry_cost: retryCost,
    provider_variance: providerVariance,
    draft_vs_premium_tradeoff: `${targetCapability.provider} draft-to-premium delta is ${targetCapability.estimated_cost_profile.premium - targetCapability.estimated_cost_profile.draft} cost units per shot.`,
    provider_forecasts: providerForeasts,
  };
}

export async function enforceCinematicGenerationBudget(input: {
  root?: string;
  jobs: CinematicGenerationJob[];
  budgetPolicy?: Partial<CinematicGenerationBudgetPolicy>;
  actualProviderExecutionRequested?: boolean;
  manualApprovalGranted?: boolean;
  now?: string;
}): Promise<CinematicGenerationBudgetEnforcementResult> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const appliedPolicy: CinematicGenerationBudgetPolicy = {
    ...record.generation_budget_policy,
    ...(input.budgetPolicy ?? {}),
  };
  const issues: string[] = [];
  const totalEstimatedSequenceCost = input.jobs.reduce((sum, entry) => sum + entry.estimated_cost, 0);
  const estimatedRetryCost = input.jobs.reduce((sum, entry) => sum + Math.min(entry.retry_count + 1, appliedPolicy.max_retries_per_job) * Math.max(1, Math.floor(entry.estimated_cost / 2)), 0);

  if (input.jobs.length > appliedPolicy.max_shots_per_batch) {
    issues.push(`Job batch exceeds max_shots_per_batch=${appliedPolicy.max_shots_per_batch}.`);
  }
  if (input.jobs.some((entry) => entry.retry_count > appliedPolicy.max_retries_per_job)) {
    issues.push(`One or more jobs exceed max_retries_per_job=${appliedPolicy.max_retries_per_job}.`);
  }
  if (totalEstimatedSequenceCost + estimatedRetryCost > appliedPolicy.max_estimated_sequence_cost) {
    issues.push(`Estimated sequence cost ${totalEstimatedSequenceCost + estimatedRetryCost} exceeds cap ${appliedPolicy.max_estimated_sequence_cost}.`);
  }
  if (input.actualProviderExecutionRequested && appliedPolicy.sandbox_only_mode) {
    issues.push("Sandbox-only mode blocks actual provider execution requests.");
  }
  if (input.actualProviderExecutionRequested && appliedPolicy.manual_approval_required && !input.manualApprovalGranted) {
    issues.push("Manual approval is required before actual provider execution.");
  }

  if (input.actualProviderExecutionRequested) {
    const now = new Date(input.now ?? new Date().toISOString()).getTime();
    for (const provider of new Set(input.jobs.map((entry) => entry.provider))) {
      const latestProviderEvent = record.generation_job_history
        .filter((entry) => entry.provider === provider)
        .filter((entry) => /ready for explicit provider execution|provider handoff approved/i.test(entry.detail))
        .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0];
      if (!latestProviderEvent) {
        continue;
      }
      const elapsedMinutes = (now - new Date(latestProviderEvent.recorded_at).getTime()) / 60_000;
      if (elapsedMinutes < appliedPolicy.provider_cooldown_minutes) {
        issues.push(`${provider} is in cooldown for another ${Math.ceil(appliedPolicy.provider_cooldown_minutes - elapsedMinutes)} minute(s).`);
      }
    }
  }

  return {
    allowed: issues.length === 0,
    total_estimated_sequence_cost: totalEstimatedSequenceCost,
    estimated_retry_cost: estimatedRetryCost,
    issues,
    applied_policy: appliedPolicy,
  };
}

export async function prepareCinematicManualTriggerBridge(input: {
  root?: string;
  jobIds: string[];
  manualApprovalGranted?: boolean;
  sandboxOnlyMode?: boolean;
  actualProviderExecutionRequested?: boolean;
  persist?: boolean;
}): Promise<CinematicManualApprovalGateResult> {
  const initialization = await loadProductionMemory(input.root);
  const jobs = initialization.record.generation_jobs.filter((entry) => input.jobIds.includes(entry.job_id));
  if (jobs.length !== input.jobIds.length) {
    throw new Error("Manual trigger bridge requires known generation jobs.");
  }

  const budget = await enforceCinematicGenerationBudget({
    root: input.root,
    jobs,
    actualProviderExecutionRequested: input.actualProviderExecutionRequested,
    manualApprovalGranted: input.manualApprovalGranted,
    budgetPolicy: {
      sandbox_only_mode: input.sandboxOnlyMode ?? initialization.record.generation_budget_policy.sandbox_only_mode,
    },
  });
  const providerExecutionAllowed = budget.allowed && Boolean(input.actualProviderExecutionRequested) && Boolean(input.manualApprovalGranted);
  const result: CinematicManualApprovalGateResult = {
    manual_approval_required: initialization.record.generation_budget_policy.manual_approval_required,
    manual_approval_granted: Boolean(input.manualApprovalGranted),
    queue_preparation_allowed: jobs.length > 0,
    provider_execution_allowed: providerExecutionAllowed,
    blocked_reason: budget.allowed ? null : budget.issues.join(" | "),
    persisted: false,
  };

  if (input.persist === false) {
    return result;
  }

  const historyEntries = jobs.map((job) => createGenerationJobHistoryEntry({
    job,
    detail: providerExecutionAllowed
      ? "Manual approval gate marked this job ready for explicit provider execution."
      : `Manual approval gate blocked provider execution: ${result.blocked_reason ?? "unknown reason"}`,
  }));
  const nextRecord: CinematicProductionMemoryRecord = {
    ...initialization.record,
    generation_job_history: [...initialization.record.generation_job_history, ...historyEntries].slice(-300),
  };
  await writeProductionMemoryRecord(initialization.productionMemoryPath, nextRecord);
  return {
    ...result,
    persisted: true,
  };
}

export async function approveCinematicGenerationJobs(input: {
  root?: string;
  operatorId: string;
  jobIds: string[];
  tokenTtlMinutes?: number;
  persist?: boolean;
}): Promise<CinematicApprovalActionResult> {
  const initialization = await loadProductionMemory(input.root);
  const jobs = resolveKnownGenerationJobs(initialization.record, input.jobIds);
  const { provider, sequenceId } = resolveSharedJobContext(jobs);
  const now = new Date();
  const token: CinematicExecutionApprovalToken = {
    token_id: `approval-token-${provider.toLowerCase()}-${sequenceId}-${Date.now()}`,
    operator_id: input.operatorId,
    provider,
    sequence_id: sequenceId,
    job_ids: input.jobIds,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ((input.tokenTtlMinutes ?? 30) * 60_000)).toISOString(),
    token_scope: "future-real-execution-bridge",
    active: true,
  };
  const updatedJobs = updateJobsForOperatorAction({
    jobs,
    status: "approved",
    approvalTokenId: token.token_id,
  });
  const auditEntry = buildApprovalAuditEntry({
    record: initialization.record,
    action: "approve-job",
    operatorId: input.operatorId,
    provider,
    sequenceId,
    jobIds: input.jobIds,
    detail: `Operator approved ${input.jobIds.length} queued job(s) and issued explicit execution token ${token.token_id}.`,
    approvalTokenId: token.token_id,
  });

  if (input.persist === false) {
    return { jobs: updatedJobs, token, audit_entries: [auditEntry], persisted: false };
  }

  const nextRecord = withUpdatedJobs(initialization.record, updatedJobs);
  await writeProductionMemoryRecord(initialization.productionMemoryPath, {
    ...nextRecord,
    execution_approval_tokens: [...initialization.record.execution_approval_tokens, token],
    approval_audit_trail: [...initialization.record.approval_audit_trail, auditEntry],
  });
  return { jobs: updatedJobs, token, audit_entries: [auditEntry], persisted: true };
}

export async function rejectCinematicGenerationJobs(input: {
  root?: string;
  operatorId: string;
  jobIds: string[];
  reason: string;
  persist?: boolean;
}): Promise<CinematicApprovalActionResult> {
  const initialization = await loadProductionMemory(input.root);
  const jobs = resolveKnownGenerationJobs(initialization.record, input.jobIds);
  const { provider, sequenceId } = resolveSharedJobContext(jobs);
  const updatedJobs = updateJobsForOperatorAction({ jobs, status: "rejected" });
  const auditEntry = buildApprovalAuditEntry({
    record: initialization.record,
    action: "reject-job",
    operatorId: input.operatorId,
    provider,
    sequenceId,
    jobIds: input.jobIds,
    detail: `Operator rejected queued jobs: ${normalizeText(input.reason)}`,
  });

  if (input.persist === false) {
    return { jobs: updatedJobs, token: null, audit_entries: [auditEntry], persisted: false };
  }

  const nextRecord = withUpdatedJobs(initialization.record, updatedJobs);
  await writeProductionMemoryRecord(initialization.productionMemoryPath, {
    ...nextRecord,
    approval_audit_trail: [...initialization.record.approval_audit_trail, auditEntry],
  });
  return { jobs: updatedJobs, token: null, audit_entries: [auditEntry], persisted: true };
}

export async function requestCinematicRetryPlan(input: {
  root?: string;
  operatorId: string;
  jobIds: string[];
  reason: string;
  persist?: boolean;
}): Promise<CinematicApprovalActionResult> {
  const initialization = await loadProductionMemory(input.root);
  const jobs = resolveKnownGenerationJobs(initialization.record, input.jobIds);
  const { provider, sequenceId } = resolveSharedJobContext(jobs);
  const updatedJobs = updateJobsForOperatorAction({ jobs, status: "retry-requested" });
  const auditEntry = buildApprovalAuditEntry({
    record: initialization.record,
    action: "request-retry-plan",
    operatorId: input.operatorId,
    provider,
    sequenceId,
    jobIds: input.jobIds,
    detail: `Operator requested a retry plan: ${normalizeText(input.reason)}`,
  });

  if (input.persist === false) {
    return { jobs: updatedJobs, token: null, audit_entries: [auditEntry], persisted: false };
  }

  const nextRecord = withUpdatedJobs(initialization.record, updatedJobs);
  await writeProductionMemoryRecord(initialization.productionMemoryPath, {
    ...nextRecord,
    approval_audit_trail: [...initialization.record.approval_audit_trail, auditEntry],
  });
  return { jobs: updatedJobs, token: null, audit_entries: [auditEntry], persisted: true };
}

export async function archiveFailedCinematicPlan(input: {
  root?: string;
  operatorId: string;
  jobIds: string[];
  reason: string;
  persist?: boolean;
}): Promise<CinematicApprovalActionResult> {
  const initialization = await loadProductionMemory(input.root);
  const jobs = resolveKnownGenerationJobs(initialization.record, input.jobIds);
  const { provider, sequenceId } = resolveSharedJobContext(jobs);
  const updatedJobs = updateJobsForOperatorAction({ jobs, status: "archived" });
  const auditEntry = buildApprovalAuditEntry({
    record: initialization.record,
    action: "archive-failed-plan",
    operatorId: input.operatorId,
    provider,
    sequenceId,
    jobIds: input.jobIds,
    detail: `Operator archived plan: ${normalizeText(input.reason)}`,
  });

  if (input.persist === false) {
    return { jobs: updatedJobs, token: null, audit_entries: [auditEntry], persisted: false };
  }

  const nextRecord = withUpdatedJobs(initialization.record, updatedJobs);
  await writeProductionMemoryRecord(initialization.productionMemoryPath, {
    ...nextRecord,
    approval_audit_trail: [...initialization.record.approval_audit_trail, auditEntry],
  });
  return { jobs: updatedJobs, token: null, audit_entries: [auditEntry], persisted: true };
}

export async function deferCinematicExecutionPlan(input: {
  root?: string;
  operatorId: string;
  jobIds: string[];
  reason: string;
  deferredUntil: string;
  persist?: boolean;
}): Promise<CinematicApprovalActionResult> {
  const initialization = await loadProductionMemory(input.root);
  const jobs = resolveKnownGenerationJobs(initialization.record, input.jobIds);
  const { provider, sequenceId } = resolveSharedJobContext(jobs);
  const deferredPlan: CinematicDeferredExecutionPlan = {
    defer_id: `deferred-plan-${provider.toLowerCase()}-${sequenceId}-${Date.now()}`,
    operator_id: input.operatorId,
    provider,
    sequence_id: sequenceId,
    job_ids: input.jobIds,
    reason: normalizeText(input.reason),
    deferred_until: input.deferredUntil,
    recorded_at: new Date().toISOString(),
    status: "deferred",
  };
  const updatedJobs = updateJobsForOperatorAction({ jobs, status: "deferred", deferredUntil: input.deferredUntil });
  const auditEntry = buildApprovalAuditEntry({
    record: initialization.record,
    action: "defer-execution",
    operatorId: input.operatorId,
    provider,
    sequenceId,
    jobIds: input.jobIds,
    detail: `Operator deferred execution until ${input.deferredUntil}: ${normalizeText(input.reason)}`,
  });

  if (input.persist === false) {
    return { jobs: updatedJobs, token: null, audit_entries: [auditEntry], persisted: false };
  }

  const nextRecord = withUpdatedJobs(initialization.record, updatedJobs);
  await writeProductionMemoryRecord(initialization.productionMemoryPath, {
    ...nextRecord,
    deferred_execution_plans: [...initialization.record.deferred_execution_plans, deferredPlan],
    approval_audit_trail: [...initialization.record.approval_audit_trail, auditEntry],
  });
  return { jobs: updatedJobs, token: null, audit_entries: [auditEntry], persisted: true };
}

export async function recordCinematicBudgetOverrideDecision(input: {
  root?: string;
  operatorId: string;
  sequenceId: string;
  provider: CinematicGenerationProvider;
  requestedBudgetCap: number;
  approvedOverride: boolean;
  reason: string;
  persist?: boolean;
}): Promise<{ decision: CinematicBudgetGovernanceDecision; audit_entry: CinematicApprovalAuditEntry; persisted: boolean }> {
  const initialization = await loadProductionMemory(input.root);
  const decision: CinematicBudgetGovernanceDecision = {
    decision_id: `budget-governance-${input.provider.toLowerCase()}-${input.sequenceId}-${Date.now()}`,
    operator_id: input.operatorId,
    provider: input.provider,
    sequence_id: input.sequenceId,
    requested_budget_cap: input.requestedBudgetCap,
    approved_override: input.approvedOverride,
    reason: normalizeText(input.reason),
    recorded_at: new Date().toISOString(),
  };
  const relatedJobIds = initialization.record.generation_jobs
    .filter((entry) => entry.sequence_id === input.sequenceId && entry.provider === input.provider)
    .map((entry) => entry.job_id);
  const auditEntry = buildApprovalAuditEntry({
    record: initialization.record,
    action: "budget-override",
    operatorId: input.operatorId,
    provider: input.provider,
    sequenceId: input.sequenceId,
    jobIds: relatedJobIds,
    detail: `${input.approvedOverride ? "Approved" : "Rejected"} budget override to ${input.requestedBudgetCap}: ${normalizeText(input.reason)}`,
    budgetOverrideDecisionId: decision.decision_id,
  });

  if (input.persist === false) {
    return { decision, audit_entry: auditEntry, persisted: false };
  }

  await writeProductionMemoryRecord(initialization.productionMemoryPath, {
    ...initialization.record,
    budget_governance_decisions: [...initialization.record.budget_governance_decisions, decision],
    approval_audit_trail: [...initialization.record.approval_audit_trail, auditEntry],
  });
  return { decision, audit_entry: auditEntry, persisted: true };
}

export async function recordCinematicContinuityReviewNote(input: {
  root?: string;
  operatorId: string;
  sequenceId: string;
  shotId?: string;
  detail: string;
  persist?: boolean;
}): Promise<{ note: CinematicContinuityReviewNote; audit_entry: CinematicApprovalAuditEntry; persisted: boolean }> {
  const initialization = await loadProductionMemory(input.root);
  const sequence = initialization.record.scene_sequences.find((entry) => entry.sequence_id === input.sequenceId);
  if (!sequence) {
    throw new Error(`Unknown cinematic sequence id: ${input.sequenceId}`);
  }
  const dependencySnapshot = input.shotId
    ? sequence.shots.find((entry) => entry.shot_id === input.shotId)?.continuity_dependencies ?? []
    : sequence.shots.flatMap((entry) => entry.continuity_dependencies);
  const provider = initialization.record.generation_jobs.find((entry) => entry.sequence_id === input.sequenceId)?.provider ?? "LocalFutureProvider";
  const relatedJobIds = initialization.record.generation_jobs.filter((entry) => entry.sequence_id === input.sequenceId).map((entry) => entry.job_id);
  const note: CinematicContinuityReviewNote = {
    note_id: `continuity-review-${input.sequenceId}-${Date.now()}`,
    operator_id: input.operatorId,
    sequence_id: input.sequenceId,
    shot_id: input.shotId ?? null,
    detail: normalizeText(input.detail),
    dependency_snapshot: dependencySnapshot,
    recorded_at: new Date().toISOString(),
  };
  const auditEntry = buildApprovalAuditEntry({
    record: initialization.record,
    action: "continuity-review-note",
    operatorId: input.operatorId,
    provider,
    sequenceId: input.sequenceId,
    jobIds: relatedJobIds,
    detail: `Operator added continuity review note: ${note.detail}`,
  });

  if (input.persist === false) {
    return { note, audit_entry: auditEntry, persisted: false };
  }

  await writeProductionMemoryRecord(initialization.productionMemoryPath, {
    ...initialization.record,
    continuity_review_notes: [...initialization.record.continuity_review_notes, note],
    approval_audit_trail: [...initialization.record.approval_audit_trail, auditEntry],
  });
  return { note, audit_entry: auditEntry, persisted: true };
}

export async function validateCinematicExecutionReadiness(input: {
  root?: string;
  jobIds: string[];
  approvalTokenId?: string;
}): Promise<CinematicExecutionReadinessReport> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const jobs = resolveKnownGenerationJobs(record, input.jobIds);
  const { provider, sequenceId } = resolveSharedJobContext(jobs);
  const approvalToken = resolveApprovalToken(record, input.approvalTokenId ?? jobs[0]?.approval_token_id ?? undefined);
  const approvalTokenValid = tokenIsValid(approvalToken, jobs);
  const continuityValidation = await validateCinematicExecutionPlan({
    root: input.root,
    sequenceId,
    shotIds: jobs.map((entry) => entry.shot_id),
  });
  const budget = await enforceCinematicGenerationBudget({
    root: input.root,
    jobs,
    actualProviderExecutionRequested: true,
    manualApprovalGranted: approvalTokenValid,
  });
  const payloadValidationResults = await Promise.all(jobs.map(async (job) => {
    const payload = await compileCinematicProviderPayload({
      root: input.root,
      jobId: job.job_id,
      provider: job.provider,
    });
    return validateCinematicProviderPayload({ root: input.root, payload });
  }));
  const providerCompatibilityPassed = payloadValidationResults.every((entry) => entry.valid);
  const dependencyCheckPassed = jobs.every((job) => job.continuity_context.dependency_shot_ids.every((dependencyShotId) => jobs.some((entry) => entry.shot_id === dependencyShotId) || job.continuity_context.preserved_output_refs.length > 0));
  const retryLimitsPassed = jobs.every((entry) => entry.retry_count <= record.generation_budget_policy.max_retries_per_job);
  const cooldownIssue = budget.issues.find((entry) => /cooldown/i.test(entry)) ?? null;

  const checks: CinematicExecutionReadinessCheck[] = [
    {
      check: "approval-present",
      passed: approvalTokenValid,
      detail: approvalTokenValid ? `Approval token ${approvalToken?.token_id ?? "unknown"} is active.` : "Explicit approval token is missing, expired, or does not match the queued jobs.",
    },
    {
      check: "budget-available",
      passed: !budget.issues.some((entry) => /Estimated sequence cost|Sandbox-only mode|Manual approval/i.test(entry)),
      detail: budget.allowed ? "Budget policy allows future execution review." : budget.issues.join(" | "),
    },
    {
      check: "continuity-validated",
      passed: continuityValidation.valid,
      detail: continuityValidation.valid ? "Continuity validation passed for the selected jobs." : continuityValidation.issues.map((entry) => entry.detail).join(" | "),
    },
    {
      check: "dependencies-resolved",
      passed: dependencyCheckPassed,
      detail: dependencyCheckPassed ? "All continuity dependencies are selected or already preserved." : "One or more continuity dependencies are unresolved.",
    },
    {
      check: "provider-compatibility",
      passed: providerCompatibilityPassed,
      detail: providerCompatibilityPassed ? "Compiled provider payloads are valid." : payloadValidationResults.flatMap((entry) => entry.issues.map((issue) => issue.detail)).join(" | "),
    },
    {
      check: "retry-limits",
      passed: retryLimitsPassed,
      detail: retryLimitsPassed ? "Retry counts remain within the bounded policy." : `Retry count exceeded max ${record.generation_budget_policy.max_retries_per_job}.`,
    },
    {
      check: "cooldown-state",
      passed: cooldownIssue === null,
      detail: cooldownIssue ?? "Provider cooldown is clear for future execution review.",
    },
  ];
  const blockedReasons = checks.filter((entry) => !entry.passed).map((entry) => entry.detail);
  return {
    provider,
    sequence_id: sequenceId,
    job_ids: input.jobIds,
    ready_for_real_execution: blockedReasons.length === 0,
    approval_token_valid: approvalTokenValid,
    approval_token: approvalToken,
    checks,
    blocked_reasons: blockedReasons,
  };
}

export async function planCinematicGenerationJobs(input: {
  root?: string;
  sequenceId: string;
  routingMode: CinematicProviderRoutingMode;
  shotIds?: string[];
  isolateRegenerationOnly?: boolean;
  persist?: boolean;
}): Promise<PlannedCinematicExecutionResult> {
  const initialization = await loadProductionMemory(input.root);
  const sequence = initialization.record.scene_sequences.find((entry) => entry.sequence_id === input.sequenceId);
  if (!sequence) {
    throw new Error(`Unknown cinematic sequence id: ${input.sequenceId}`);
  }
  const beat = initialization.record.story_beats.find((entry) => entry.beat_id === sequence.beat_id);
  if (!beat) {
    throw new Error(`Unknown cinematic beat id: ${sequence.beat_id}`);
  }
  const routing = selectCinematicGenerationProviderRoute({ routingMode: input.routingMode });
  const selectedCapability = resolveProviderCapability(initialization.record, routing.provider);

  const validation = await validateCinematicExecutionPlan({
    root: input.root,
    sequenceId: input.sequenceId,
    shotIds: input.shotIds,
    isolateRegenerationOnly: input.isolateRegenerationOnly,
  });
  if (!validation.valid) {
    return {
      routing,
      validation,
      jobs: [],
      batches: [],
      blocked: true,
      persisted: false,
    };
  }

  const regenerationPlan = input.isolateRegenerationOnly
    ? await planFailedShotRegeneration({ root: input.root, sequenceId: input.sequenceId })
    : null;
  const selectedShotIds = input.isolateRegenerationOnly
    ? regenerationPlan?.failed_shot_ids ?? []
    : input.shotIds ?? sequence.shots.map((entry) => entry.shot_id);
  const selectedShots = [...sequence.shots]
    .filter((entry) => selectedShotIds.includes(entry.shot_id))
    .sort((left, right) => left.shot_order - right.shot_order);
  const preservedOutputRefs = initialization.record.generation_jobs
    .filter((entry) => regenerationPlan?.preserved_successful_shot_ids.includes(entry.shot_id) && entry.output_refs.length > 0)
    .flatMap((entry) => entry.output_refs);

  const createdAt = new Date().toISOString();
  const jobs = selectedShots.map((shot) => ({
    job_id: `job-${initialization.record.project_key}-${routing.provider.toLowerCase()}-${sequence.sequence_id}-${shot.shot_id}`,
    project_key: initialization.record.project_key,
    provider: routing.provider,
    sequence_id: sequence.sequence_id,
    shot_id: shot.shot_id,
    prompt_payload: buildExecutionPromptPayload({
      record: initialization.record,
      sequence,
      shot,
      beat,
      route: routing,
    }),
    continuity_context: {
      dependency_shot_ids: resolveExecutionDependencyShotIds(sequence, shot),
      continuity_constraints: [...initialization.record.continuity_rules, ...shot.continuity_dependencies],
      preserved_output_refs: preservedOutputRefs,
      sequence_order_index: shot.shot_order,
    },
    generation_status: "planned",
    retry_count: 0,
    estimated_cost: getEstimatedProviderCost(selectedCapability, routing.estimated_cost_tier),
    output_refs: [],
    validation_state: "validated",
    requires_manual_approval: initialization.record.generation_budget_policy.manual_approval_required,
    manual_approval_status: initialization.record.generation_budget_policy.manual_approval_required ? "pending" : "approved",
    approval_token_id: null,
    deferred_until: null,
    last_operator_action_at: null,
    created_at: createdAt,
  } satisfies CinematicGenerationJob));
  const batches = buildShotBatches({
    sequence: {
      ...sequence,
      shots: selectedShots,
    },
    provider: routing.provider,
    jobs,
    regenerationOnly: Boolean(input.isolateRegenerationOnly),
  });

  if (input.persist === false) {
    return {
      routing,
      validation,
      jobs,
      batches,
      blocked: false,
      persisted: false,
    };
  }

  const nextRecord: CinematicProductionMemoryRecord = {
    ...initialization.record,
    generation_jobs: upsertGenerationJobs(initialization.record.generation_jobs, jobs),
    generation_job_history: [
      ...initialization.record.generation_job_history,
      ...jobs.map((job) => createGenerationJobHistoryEntry({ job, detail: "Job planned in cinematic execution sandbox." })),
    ].slice(-200),
  };
  await writeProductionMemoryRecord(initialization.productionMemoryPath, nextRecord);
  return {
    routing,
    validation,
    jobs,
    batches,
    blocked: false,
    persisted: true,
  };
}

function deterministicSandboxFailure(job: CinematicGenerationJob): boolean {
  return (
    (job.provider === "Seedance" && /escalation/i.test(job.shot_id) && job.retry_count === 0)
    || (job.provider === "Runway" && /transition/i.test(job.shot_id) && job.retry_count === 0)
  );
}

function updateGenerationJob(job: CinematicGenerationJob, input: {
  generation_status: CinematicGenerationStatus;
  validation_state?: CinematicGenerationValidationState;
  output_refs?: string[];
}): CinematicGenerationJob {
  return {
    ...job,
    generation_status: input.generation_status,
    validation_state: input.validation_state ?? job.validation_state,
    output_refs: input.output_refs ?? job.output_refs,
  };
}

export async function simulateCinematicExecutionSandbox(input: {
  root?: string;
  sequenceId: string;
  routingMode: CinematicProviderRoutingMode;
  isolateRegenerationOnly?: boolean;
}): Promise<CinematicSandboxSimulationResult> {
  const initialization = await loadProductionMemory(input.root);
  const planned = await planCinematicGenerationJobs({
    root: input.root,
    sequenceId: input.sequenceId,
    routingMode: input.routingMode,
    isolateRegenerationOnly: input.isolateRegenerationOnly,
  });
  if (planned.blocked) {
    throw new Error(`Cinematic execution sandbox blocked: ${planned.validation.issues.map((entry) => entry.detail).join(" | ")}`);
  }

  const jobs: CinematicGenerationJob[] = [];
  const historyEntries: CinematicGenerationJobHistoryEntry[] = [];
  const retryJobs: CinematicGenerationJob[] = [];
  const approvedJobIds: string[] = [];
  const failedJobIds: string[] = [];
  const retryJobIds: string[] = [];
  const assetReuseDecisions: string[] = [];
  let approvedOutputRefs: string[] = [];

  const transition = (job: CinematicGenerationJob, generationStatus: CinematicGenerationStatus, detail: string, validationState?: CinematicGenerationValidationState, outputRefs?: string[]): CinematicGenerationJob => {
    const nextJob = updateGenerationJob(job, {
      generation_status: generationStatus,
      validation_state: validationState,
      output_refs: outputRefs,
    });
    historyEntries.push(createGenerationJobHistoryEntry({ job: nextJob, detail }));
    return nextJob;
  };

  for (const plannedJob of planned.jobs) {
    let job = transition(plannedJob, "queued", "Job queued in deterministic sandbox simulation.");
    job = transition(job, "generating", "Job entered provider-ready generation stub.");
    job = transition(job, "validating", "Job entered continuity-preserving validation step.");

    if (deterministicSandboxFailure(job)) {
      job = transition(job, "failed", "Deterministic sandbox failure triggered for retry planning.");
      job = transition(job, "retry-required", "Retry required while preserving successful neighboring outputs.", "validated");
      failedJobIds.push(job.job_id);
      const retryJob: CinematicGenerationJob = {
        ...job,
        job_id: `${job.job_id}-retry-${job.retry_count + 1}`,
        retry_count: job.retry_count + 1,
        continuity_context: {
          ...job.continuity_context,
          preserved_output_refs: approvedOutputRefs,
        },
        generation_status: "planned",
        output_refs: [],
      };
      let resolvedRetryJob = transition(retryJob, "queued", "Retry job queued in regeneration-only sandbox batch.");
      resolvedRetryJob = transition(resolvedRetryJob, "generating", "Retry job entered provider-ready generation stub.");
      resolvedRetryJob = transition(resolvedRetryJob, "validating", "Retry job re-entered validation.");
      const retryOutputRefs = [`sandbox://${resolvedRetryJob.provider}/${resolvedRetryJob.job_id}/approved-1`];
      resolvedRetryJob = transition(resolvedRetryJob, "approved", "Retry job approved after deterministic sandbox recovery.", "validated", retryOutputRefs);
      retryJobs.push(resolvedRetryJob);
      retryJobIds.push(resolvedRetryJob.job_id);
      approvedJobIds.push(resolvedRetryJob.job_id);
      approvedOutputRefs = [...approvedOutputRefs, ...retryOutputRefs];
      assetReuseDecisions.push(`Preserve successful outputs ${approvedOutputRefs.join(", ")} while retrying ${job.shot_id}.`);
    } else {
      const outputRefs = [`sandbox://${job.provider}/${job.job_id}/approved-1`];
      job = transition(job, "approved", "Job approved by deterministic sandbox validation.", "validated", outputRefs);
      approvedJobIds.push(job.job_id);
      approvedOutputRefs = [...approvedOutputRefs, ...outputRefs];
      assetReuseDecisions.push(`Reuse environment and character context for ${job.shot_id} after approved sandbox output.`);
    }

    jobs.push(job);
  }

  const simulation: CinematicSandboxSimulationRecord = {
    simulation_id: `simulation-${planned.routing.provider.toLowerCase()}-${planned.validation.sequence_id}-${Date.now()}`,
    sandbox_kind: "provider-execution-sandbox",
    sequence_id: planned.validation.sequence_id,
    routing_mode: input.routingMode,
    provider: planned.routing.provider,
    execution_enabled: false,
    queued_job_ids: planned.jobs.map((entry) => entry.job_id),
    approved_job_ids: approvedJobIds,
    failed_job_ids: failedJobIds,
    retry_job_ids: retryJobIds,
    continuity_issue_count: planned.validation.issues.length,
    asset_reuse_decisions: assetReuseDecisions,
    readiness_tracking_id: null,
    hybrid_escalation: null,
    recorded_at: new Date().toISOString(),
  };

  const nextRecord: CinematicProductionMemoryRecord = {
    ...initialization.record,
    generation_jobs: upsertGenerationJobs(initialization.record.generation_jobs, [...jobs, ...retryJobs]),
    generation_job_history: [...initialization.record.generation_job_history, ...historyEntries].slice(-300),
    sandbox_simulations: [...initialization.record.sandbox_simulations, simulation].slice(-40),
    asset_reuse_decisions: [...initialization.record.asset_reuse_decisions, ...assetReuseDecisions].slice(-40),
  };
  await writeProductionMemoryRecord(initialization.productionMemoryPath, nextRecord);

  return {
    simulation,
    jobs,
    history_entries: historyEntries,
    retry_jobs: retryJobs,
  };
}

export async function compareCinematicProviderOutputs(input: {
  root?: string;
  sequenceId: string;
}): Promise<CinematicProviderOutputComparison[]> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const byProvider = new Map<CinematicGenerationProvider, CinematicProviderOutputComparison>();

  for (const job of record.generation_jobs.filter((entry) => entry.sequence_id === input.sequenceId)) {
    const current = byProvider.get(job.provider) ?? {
      provider: job.provider,
      approved_jobs: 0,
      failed_jobs: 0,
      total_outputs: 0,
      total_estimated_cost: 0,
    };
    current.approved_jobs += job.generation_status === "approved" ? 1 : 0;
    current.failed_jobs += job.generation_status === "failed" || job.generation_status === "retry-required" ? 1 : 0;
    current.total_outputs += job.output_refs.length;
    current.total_estimated_cost += job.estimated_cost;
    byProvider.set(job.provider, current);
  }

  return [...byProvider.values()].sort((left, right) => left.provider.localeCompare(right.provider));
}

export async function planFailedShotRegeneration(input: {
  root?: string;
  sequenceId: string;
}): Promise<FailedShotRegenerationPlan> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const sequence = record.scene_sequences.find((entry) => entry.sequence_id === input.sequenceId);
  if (!sequence) {
    throw new Error(`Unknown cinematic sequence id: ${input.sequenceId}`);
  }

  const generationEntries = [...record.failed_generations, ...record.successful_generations];
  const failed_shot_ids: string[] = [];
  const preserved_successful_shot_ids: string[] = [];

  for (const shot of sequence.shots) {
    const latest = latestGenerationStatus(generationEntries, shot.shot_id);
    if (latest?.status === "failed") {
      failed_shot_ids.push(shot.shot_id);
    } else if (latest?.status === "successful") {
      preserved_successful_shot_ids.push(shot.shot_id);
    }
  }

  return {
    sequence_id: sequence.sequence_id,
    failed_shot_ids,
    preserved_successful_shot_ids,
    continuity_state: [
      ...record.continuity_rules,
      `Preserve environment continuity for ${sequence.shots.map((entry) => entry.environment_id).join(", ")}`,
      `Preserve approved successful shots: ${preserved_successful_shot_ids.join(", ") || "none"}`,
    ],
  };
}

function estimateCostTier(record: CinematicProductionMemoryRecord, beat: CinematicStoryBeat, shot: CinematicShotRecord): CostTier {
  const constraintCount = record.continuity_rules.length + beat.continuity_dependencies.length;
  const motionWeight = /crane|drone|long take|complex/i.test(shot.camera_motion) ? 2 : 0;
  const styleWeight = record.visual_style.length > 3 ? 1 : 0;
  const total = constraintCount + motionWeight + styleWeight;
  if (total >= 8) {
    return "high";
  }
  if (total >= 5) {
    return "medium";
  }
  return "low";
}

export async function compileCinematicShotPrompt(input: {
  root?: string;
  shotId: string;
}): Promise<CompiledCinematicShotPrompt> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const shot = record.shot_history.find((entry) => entry.shot_id === input.shotId);
  if (!shot) {
    throw new Error(`Unknown cinematic shot id: ${input.shotId}`);
  }

  const beat = record.story_beats.find((entry) => entry.beat_id === shot.beat_id);
  if (!beat) {
    throw new Error(`Unknown cinematic beat id: ${shot.beat_id}`);
  }

  const assetReuseCandidates = record.generated_assets
    .filter((entry) => entry.reusable)
    .map((entry) => `${entry.asset_id}: ${entry.label}`)
    .slice(0, 6);
  const sequence = record.scene_sequences.find((entry) => entry.shots.some((candidate) => candidate.shot_id === shot.shot_id));
  const plannedShot = sequence?.shots.find((entry) => entry.shot_id === shot.shot_id);
  const priorPlannedShot = sequence && plannedShot
    ? [...sequence.shots]
      .sort((left, right) => left.shot_order - right.shot_order)
      .find((entry) => entry.shot_order === plannedShot.shot_order - 1)
    : undefined;
  const relatedTrigger = sequence
    ? record.gameplay_cutscene_triggers.find((entry) => entry.target_sequence_id === sequence.sequence_id)
    : undefined;
  const estimatedCostTier = estimateCostTier(record, beat, shot);

  const prompt = [
    `Project: ${record.project_key}`,
    `Scene context: ${sequence?.title ?? record.gameplay_context.current_sequence}`,
    `Beat: ${beat.title}`,
    `Intent: ${shot.intent}`,
    `Emotional target: ${beat.emotional_goal}`,
    `Emotional tone set: ${record.emotional_tone.join(", ")}`,
    `Visual style: ${record.visual_style.join(", ")}`,
    `Camera intent: ${plannedShot?.camera_behavior ?? shot.camera_framing}; ${shot.camera_motion}; ${shot.lens_language}`,
    `Prior shot context: ${priorPlannedShot ? `${priorPlannedShot.shot_purpose} -> ${priorPlannedShot.transition_notes}` : "none"}`,
    `Lighting: ${shot.lighting_direction}`,
    `Environment cues: ${record.environments.map((entry) => entry.name).join(", ")}`,
    `Gameplay context: ${record.gameplay_context.current_sequence}`,
    `Gameplay transition: ${relatedTrigger ? `${relatedTrigger.gameplay_state} -> ${relatedTrigger.cinematic_state}` : beat.gameplay_trigger}`,
    `Avoid breaking continuity: ${[...record.continuity_rules, ...beat.continuity_dependencies].join(" | ")}`,
  ].join("\n");

  return {
    shot_id: shot.shot_id,
    project_key: record.project_key,
    beat_id: beat.beat_id,
    sequence_id: sequence?.sequence_id,
    prompt,
    continuity_constraints: [...record.continuity_rules, ...beat.continuity_dependencies],
    asset_reuse_candidates: assetReuseCandidates,
    prior_shot_context: priorPlannedShot ? `${priorPlannedShot.shot_id}: ${priorPlannedShot.transition_notes}` : null,
    gameplay_transition_context: relatedTrigger
      ? [relatedTrigger.gameplay_state, relatedTrigger.cinematic_state, ...relatedTrigger.transition_notes]
      : [record.gameplay_context.current_sequence, ...record.gameplay_context.trigger_conditions],
    estimated_cost_tier: estimatedCostTier,
  };
}