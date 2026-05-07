import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRoot, resolveRepoRootSync } from "./repoContext";

const SECOND_BRAIN_DIR = path.join("data", "second_brain");
const PRODUCTION_MEMORY_FILE = "production_memory.json";
const DEFAULT_CREATED_AT = "2026-05-07T00:00:00.000Z";

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
  | "continuity-review-note";

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
  sequence_id: string;
  routing_mode: CinematicProviderRoutingMode;
  provider: CinematicGenerationProvider;
  queued_job_ids: string[];
  approved_job_ids: string[];
  failed_job_ids: string[];
  retry_job_ids: string[];
  continuity_issue_count: number;
  asset_reuse_decisions: string[];
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

  return {
    provider: capability.provider,
    valid: issues.length === 0,
    issues,
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
    sequence_id: planned.validation.sequence_id,
    routing_mode: input.routingMode,
    provider: planned.routing.provider,
    queued_job_ids: planned.jobs.map((entry) => entry.job_id),
    approved_job_ids: approvedJobIds,
    failed_job_ids: failedJobIds,
    retry_job_ids: retryJobIds,
    continuity_issue_count: planned.validation.issues.length,
    asset_reuse_decisions: assetReuseDecisions,
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