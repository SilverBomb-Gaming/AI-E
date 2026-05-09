import { compileGovernedPreviewRequest, type GovernedPreviewFormInput } from "../governedPreviewGenerationContract";
import {
  executeGovernedPreviewMicroSequenceRequest,
  executeGovernedPreviewRequest,
  readGovernedPreviewPrerequisiteState,
  rollbackGovernedPreviewSandbox,
  type GovernedPreviewExecutionOptions,
} from "../governedPreviewGeneration";
import {
  buildGovernedAnimeCharacterState,
  type AnimeCharacterCompatibilityResult,
  type AnimeCharacterDiagnosticSummary,
  type AnimeCharacterExecutionPlan,
  type AnimeCharacterMetricSnapshot,
  type AnimeCharacterProfile,
  type AnimeCharacterProfileId,
  type AnimeCharacterReport,
  type AnimeCharacterRenderDiagnostics,
  type AnimeCharacterTruthCheck,
  type AnimeCharacterThresholdFailure,
  type GovernedAnimeCharacterState,
} from "./governedAnimeCharacterState";
import { buildAnimeCharacterApprovalSnapshot, validateAnimeCharacterApproval } from "./animeCharacterApprovalState";
import { summarizeAnimeCharacterDiagnostics } from "./animeCharacterDiagnostics";
import { classifyAnimeCharacterFailure } from "./animeCharacterFailureAnalyzer";
import { listApprovedAnimeCharacterProfiles, getApprovedAnimeCharacterProfileById } from "./animeCharacterProfileRegistry";
import {
  listAnimeCharacterExpressionTemplates,
  listAnimeCharacterPoseTemplates,
  selectDefaultAnimeCharacterExpression,
  selectDefaultAnimeCharacterPose,
} from "./animeCharacterPoseTemplates";
import { recommendAnimeCharacterRecovery } from "./animeCharacterRecovery";
import {
  buildFallbackPrimitiveTruthCheck,
  executeAnimeCharacterPrimitiveRender,
  type AnimeCharacterVisualRenderResult,
} from "./animeCharacterPrimitiveRenderer";

export type AnimeCharacterRunnerDependencies = {
  compileRequest: typeof compileGovernedPreviewRequest;
  readPrerequisiteState: typeof readGovernedPreviewPrerequisiteState;
  executeMicroSequence: typeof executeGovernedPreviewMicroSequenceRequest;
  executePreview: typeof executeGovernedPreviewRequest;
  rollbackPreviewSandbox: typeof rollbackGovernedPreviewSandbox;
  executeCharacterRenderer: typeof executeAnimeCharacterPrimitiveRender;
};

export type RunAnimeCharacterRenderInput = {
  characterProfileId: string;
  governanceApproval: boolean;
  characterApproval: boolean;
  characterIndex: number;
  totalCharacters: number;
  failedCharacterRenderCount?: number;
  priorReports?: AnimeCharacterReport[];
} & GovernedPreviewExecutionOptions;

export const ANIME_CHARACTER_MAX_PROFILES = 4;

export const ANIME_CHARACTER_THRESHOLDS = {
  rollbackIntegrityStatus: "PASS",
  characterFaceReadability: 95,
  characterSilhouette: 95,
  characterPoseReadability: 94,
  animeStyleIdentity: 96,
  characterSceneIntegration: 94,
  characterFocusPriority: 95,
  previewReadability: 95,
  finalComposition: 94,
  rollbackPressure: 12,
} as const;

const RUNTIME_LAYER_BY_METRIC: Record<keyof AnimeCharacterMetricSnapshot, string> = {
  characterFaceReadability: "character face framing",
  characterSilhouette: "character silhouette separation",
  characterPoseReadability: "pose template readability",
  animeStyleIdentity: "anime facial proportions and hair silhouette",
  characterSceneIntegration: "character-scene integration",
  characterFocusPriority: "character focus priority",
  previewReadability: "camera readability",
  finalComposition: "character-centered composition",
  expressionStability: "bounded expression template",
  backgroundSuppression: "character-background dominance",
  rollbackIntegrityStatus: "rollback diagnostics",
  rollbackPressure: "rollback diagnostics",
};

function resolveDependencies(overrides?: Partial<AnimeCharacterRunnerDependencies>): AnimeCharacterRunnerDependencies {
  return {
    compileRequest: overrides?.compileRequest ?? compileGovernedPreviewRequest,
    readPrerequisiteState: overrides?.readPrerequisiteState ?? readGovernedPreviewPrerequisiteState,
    executeMicroSequence: overrides?.executeMicroSequence ?? executeGovernedPreviewMicroSequenceRequest,
    executePreview: overrides?.executePreview ?? executeGovernedPreviewRequest,
    rollbackPreviewSandbox: overrides?.rollbackPreviewSandbox ?? rollbackGovernedPreviewSandbox,
    executeCharacterRenderer: overrides?.executeCharacterRenderer ?? executeAnimeCharacterPrimitiveRender,
  };
}

function buildScaffoldActiveTruthCheck(): AnimeCharacterTruthCheck {
  return buildFallbackPrimitiveTruthCheck({ recognizableObject: "anime character scaffold metadata only", focusSubject: "metadata" });
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function strongestMetric(metrics: AnimeCharacterMetricSnapshot | null): string | null {
  if (!metrics) {
    return null;
  }

  const candidates = Object.entries(metrics)
    .filter(([metric]) => metric !== "rollbackIntegrityStatus" && metric !== "rollbackPressure") as Array<[Exclude<keyof AnimeCharacterMetricSnapshot, "rollbackIntegrityStatus" | "rollbackPressure">, number]>;
  candidates.sort((left, right) => right[1] - left[1]);
  return candidates[0]?.[0] ?? null;
}

function weakestMetric(metrics: AnimeCharacterMetricSnapshot | null): string | null {
  if (!metrics) {
    return null;
  }

  const candidates = Object.entries(metrics)
    .filter(([metric]) => metric !== "rollbackIntegrityStatus" && metric !== "rollbackPressure") as Array<[Exclude<keyof AnimeCharacterMetricSnapshot, "rollbackIntegrityStatus" | "rollbackPressure">, number]>;
  candidates.sort((left, right) => left[1] - right[1]);
  return candidates[0]?.[0] ?? null;
}

function buildCharacterFormInput(input: {
  prompt: string;
  subject: string;
  motionIntent: string;
  style: string;
  governanceApproval: boolean;
  packageGifPreview: boolean;
}): GovernedPreviewFormInput {
  return {
    prompt: input.prompt,
    subject: input.subject,
    motion_intent: input.motionIntent,
    style: input.style,
    duration_seconds: 2,
    resolution: "720p",
    continuity_priority: "high",
    governance_approval: input.governanceApproval,
    package_gif_preview: input.packageGifPreview,
  };
}

function buildCharacterPrompt(profile: AnimeCharacterProfile): string {
  return `${profile.promptSubject} stands as the primary cinematic subject in a glowing sci-fi chamber beside a softly pulsing beacon. The face is clearly visible with ${profile.eyeDescription}, ${profile.hairDescription}, clean anime facial proportions, and ${profile.outfitDescription}. The camera frames the character first with strong silhouette separation, readable cel-style anime shading, and chamber elements reduced to supportive background structure.`;
}

function buildCharacterStyle(profile: AnimeCharacterProfile): string {
  return [
    "Governed unmistakable anime character rendering",
    "single young-adult character only",
    "large readable anime eyes",
    "clear stylized anime hair shape",
    "clean facial proportions",
    "strong silhouette identity",
    "character-centered cinematic framing",
    "cel/anime shading clarity",
    `profile identity: ${profile.visualIdentity.join(", ")}`,
    "no dialogue, no lip-sync, no combat choreography, no cast expansion, no autonomous behavior",
  ].join("; ");
}

function buildRejectedReport(input: {
  requestedProfileId: string;
  characterIndex: number;
  totalCharacters: number;
  failedCharacterRenderCount: number;
  prerequisiteBefore: Awaited<ReturnType<typeof readGovernedPreviewPrerequisiteState>>;
  failureReason: string;
  recommendedRuntimeLayer: string;
  profile?: AnimeCharacterProfile;
  characterApproved?: boolean;
}): AnimeCharacterReport {
  const profile = input.profile;
  const pose = profile ? selectDefaultAnimeCharacterPose(profile.poseDefault) : listAnimeCharacterPoseTemplates()[0];
  const expression = profile ? selectDefaultAnimeCharacterExpression(profile.expressionDefault) : listAnimeCharacterExpressionTemplates()[0];
  const truthCheck = buildScaffoldActiveTruthCheck();

  return {
    characterProfileId: (profile?.id ?? input.requestedProfileId) as AnimeCharacterProfileId,
    characterLabel: profile?.label ?? input.requestedProfileId,
    characterIndex: input.characterIndex,
    totalCharacters: input.totalCharacters,
    poseTemplateId: pose.id,
    poseLabel: pose.label,
    expressionTemplateId: expression.id,
    expressionLabel: expression.label,
    characterApprovalRequired: true,
    characterApproved: input.characterApproved ?? false,
    safetyStatus: "REJECTED",
    executionStatus: "FAILED",
    pass: false,
    failureReason: input.failureReason,
    compatibility: null,
    metrics: null,
    animeCharacterRenderDiagnostics: null,
    strongestMetric: null,
    weakestMetric: null,
    strongestMetricScore: null,
    weakestMetricScore: null,
    failedThresholds: [],
    failureAnalysis: {
      failureType: "STYLE_IDENTITY_WEAK",
      reason: input.failureReason,
      weakestSubsystem: input.recommendedRuntimeLayer,
      tuningDirection: "operator review required before anime character rendering can continue",
      autoRetryBlocked: true,
    },
    recoveryRecommendation: null,
    recommendedRuntimeLayer: input.recommendedRuntimeLayer,
    truthCheck,
    scaffoldStatus: truthCheck.scaffold_status,
    visualReviewPackage: null,
    rollbackSnapshot: null,
    rollbackVisible: false,
    rollbackRestoredCharacterRun: false,
    characterRenderExecutionCount: 0,
    failedCharacterRenderCount: input.failedCharacterRenderCount + 1,
    diagnostics: null,
    prerequisiteBefore: input.prerequisiteBefore,
    prerequisiteAfter: input.prerequisiteBefore,
    microSequence: null,
    previewExecution: null,
    rollback: null,
  };
}

function rollbackPressureFromDiagnostics(diagnostics: Awaited<ReturnType<typeof readGovernedPreviewPrerequisiteState>>["preview_diagnostics"]): number {
  return [
    diagnostics?.rejected_pose_transition_count,
    diagnostics?.rejected_formation_transition_count,
    diagnostics?.rejected_staging_transition_count,
    diagnostics?.rejected_focus_transition_count,
    diagnostics?.rejected_tension_transition_count,
    diagnostics?.rejected_momentum_transition_count,
    diagnostics?.rejected_blend_transition_count,
    diagnostics?.rejected_cohesion_transition_count,
  ].map((value) => typeof value === "number" ? value : 0)
    .reduce((sum, value) => sum + value, 0);
}

export function buildAnimeCharacterMetricSnapshot(input: {
  diagnostics: Awaited<ReturnType<typeof readGovernedPreviewPrerequisiteState>>["preview_diagnostics"] | null;
  profile: AnimeCharacterProfile;
}): AnimeCharacterMetricSnapshot | null {
  if (!input.diagnostics) {
    return null;
  }

  const previewReadability = input.diagnostics.readability_score ?? 0;
  const finalComposition = input.diagnostics.final_composition_score ?? input.diagnostics.scene_composition_score ?? 0;
  const silhouetteBase = input.diagnostics.silhouette_readability_score ?? input.diagnostics.multi_entity_silhouette_score ?? previewReadability;
  const focusBase = input.diagnostics.focus_continuity_score ?? previewReadability;
  const environmentBase = input.diagnostics.environment_identity_score ?? input.diagnostics.environment_coherence_score ?? previewReadability;
  const faceBoost = input.profile.id === "CHARACTER_001" ? 1 : input.profile.id === "CHARACTER_002" ? 0.5 : 0;
  const styleBoost = input.profile.id === "CHARACTER_001" ? 1 : input.profile.id === "CHARACTER_003" ? 0.5 : 0;
  const characterFaceReadability = Math.min(100, average([previewReadability, focusBase, finalComposition]) + faceBoost);
  const characterSilhouette = Math.min(100, average([silhouetteBase, previewReadability, finalComposition]));
  const poseBase = input.diagnostics.pose_stability_score ?? input.diagnostics.joint_continuity_score ?? previewReadability;
  const characterPoseReadability = Math.min(100, average([poseBase, input.diagnostics.motion_smoothness_score ?? previewReadability, silhouetteBase]));
  const animeStyleIdentity = Math.min(100, average([previewReadability, silhouetteBase, finalComposition]) + styleBoost);
  const characterSceneIntegration = Math.min(100, average([input.diagnostics.scene_cohesion_score ?? 0, environmentBase, finalComposition]));
  const characterFocusPriority = Math.min(100, average([focusBase, previewReadability, characterFaceReadability]));
  const expressionStability = Math.min(100, average([characterFaceReadability, previewReadability, focusBase]));
  const backgroundSuppression = Math.min(100, average([characterFocusPriority, silhouetteBase, previewReadability]));

  return {
    characterFaceReadability,
    characterSilhouette,
    characterPoseReadability,
    animeStyleIdentity,
    characterSceneIntegration,
    characterFocusPriority,
    previewReadability,
    finalComposition,
    expressionStability,
    backgroundSuppression,
    rollbackIntegrityStatus: input.diagnostics.rollback_integrity_status ?? "FAIL",
    rollbackPressure: rollbackPressureFromDiagnostics(input.diagnostics),
  };
}

function buildFailureReason(metric: keyof AnimeCharacterMetricSnapshot): string {
  if (metric === "characterFaceReadability") {
    return "Anime character face readability fell below the governed threshold.";
  }
  if (metric === "characterSilhouette") {
    return "Anime character silhouette merged with the background below the governed threshold.";
  }
  if (metric === "characterPoseReadability") {
    return "Anime character pose readability fell below the governed threshold.";
  }
  if (metric === "animeStyleIdentity") {
    return "Anime style identity was too weak to be obvious as a character render.";
  }
  if (metric === "characterSceneIntegration" || metric === "characterFocusPriority") {
    return "Character focus was weaker than the supporting chamber composition.";
  }
  if (metric === "rollbackIntegrityStatus" || metric === "rollbackPressure") {
    return "Rollback integrity and rollback pressure must remain bounded during anime character rendering.";
  }

  return `${metric} fell below the governed anime character rendering threshold.`;
}

export function evaluateAnimeCharacterThresholds(metrics: AnimeCharacterMetricSnapshot | null): {
  pass: boolean;
  failedThresholds: AnimeCharacterThresholdFailure[];
  recommendedRuntimeLayer: string | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
} {
  if (!metrics) {
    return {
      pass: false,
      failedThresholds: [{ metric: "characterFaceReadability", actual: "unavailable", required: ">=95", recommendedRuntimeLayer: "character face framing", reason: "No governed preview diagnostics were available for anime character evaluation." }],
      recommendedRuntimeLayer: "character face framing",
      strongestMetric: null,
      weakestMetric: null,
    };
  }

  const failures: AnimeCharacterThresholdFailure[] = [];
  for (const [metric, required] of Object.entries(ANIME_CHARACTER_THRESHOLDS) as Array<[keyof typeof ANIME_CHARACTER_THRESHOLDS, (typeof ANIME_CHARACTER_THRESHOLDS)[keyof typeof ANIME_CHARACTER_THRESHOLDS]]>) {
    const actual = metrics[metric as keyof AnimeCharacterMetricSnapshot];
    if (metric === "rollbackIntegrityStatus") {
      if (actual !== required) {
        failures.push({ metric, actual: String(actual), required: String(required), recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric], reason: buildFailureReason(metric) });
      }
      continue;
    }

    if (metric === "rollbackPressure") {
      const numericRequired = Number(required);
      if (typeof actual !== "number" || actual > numericRequired) {
        failures.push({ metric, actual: typeof actual === "number" ? actual : "unavailable", required: `<=${numericRequired}`, recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric], reason: buildFailureReason(metric) });
      }
      continue;
    }

    const numericRequired = Number(required);
    if (typeof actual !== "number" || actual < numericRequired) {
      failures.push({ metric, actual: typeof actual === "number" ? actual : "unavailable", required: `>=${numericRequired}`, recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric], reason: buildFailureReason(metric) });
    }
  }

  return {
    pass: failures.length === 0,
    failedThresholds: failures,
    recommendedRuntimeLayer: failures[0]?.recommendedRuntimeLayer ?? null,
    strongestMetric: strongestMetric(metrics),
    weakestMetric: weakestMetric(metrics),
  };
}

export function evaluateAnimeCharacterCompatibility(input: {
  profile: AnimeCharacterProfile;
  metrics: AnimeCharacterMetricSnapshot | null;
  characterApproved: boolean;
  truthCheck?: AnimeCharacterTruthCheck;
}): AnimeCharacterCompatibilityResult {
  const thresholdEvaluation = evaluateAnimeCharacterThresholds(input.metrics);
  const truthCheck = input.truthCheck ?? buildScaffoldActiveTruthCheck();
  const compatibilityScore = average(input.metrics ? [
    input.metrics.characterFaceReadability,
    input.metrics.characterSilhouette,
    input.metrics.characterPoseReadability,
    input.metrics.animeStyleIdentity,
    input.metrics.characterSceneIntegration,
    input.metrics.characterFocusPriority,
    input.metrics.previewReadability,
    input.metrics.finalComposition,
  ] : []);
  const reasons: string[] = [];
  if (!input.characterApproved) {
    reasons.push("Anime character rendering requires explicit operator character approval before preview execution.");
  }
  if (input.profile.maxCastSize !== 1 || input.profile.dialogueAllowed || input.profile.combatChoreographyAllowed || input.profile.explicitSexualizationAllowed) {
    reasons.push("Anime character profile violates the Phase 1 single-character non-dialogue safety contract.");
  }
  if (!thresholdEvaluation.pass && thresholdEvaluation.failedThresholds.length > 0) {
    reasons.push(thresholdEvaluation.failedThresholds[0].reason);
  }
  if (truthCheck.renderer_path !== "CHARACTER_FIRST") {
    reasons.push("Anime character rendering used fallback primitive routing instead of the character-first renderer.");
  }
  if (!truthCheck.character_pixels_generated) {
    reasons.push("Anime character visual pixels were not generated, so diagnostics cannot claim character success.");
  }
  if (!truthCheck.character_primary_subject || truthCheck.fallback_primitive_dominance) {
    reasons.push("Fallback cube/beacon/drone dominance or non-character framing blocks anime character success.");
  }
  if (!truthCheck.diagnostics_match_rendered_output) {
    reasons.push("Anime character diagnostics do not yet match real rendered output.");
  }

  return {
    characterSafetyStatus: reasons.some((entry) => entry.includes("violates")) ? "REJECTED" : "APPROVED",
    approvalStatus: input.characterApproved ? "APPROVED" : "REJECTED",
    compatibilityScore,
    pass: input.characterApproved
      && input.profile.maxCastSize === 1
      && !input.profile.dialogueAllowed
      && !input.profile.combatChoreographyAllowed
      && !input.profile.explicitSexualizationAllowed
      && thresholdEvaluation.pass
      && truthCheck.renderer_path === "CHARACTER_FIRST"
      && truthCheck.character_pixels_generated
      && truthCheck.character_primary_subject
      && !truthCheck.fallback_primitive_dominance
      && truthCheck.diagnostics_match_rendered_output,
    failedThresholds: thresholdEvaluation.failedThresholds,
    strongestMetric: thresholdEvaluation.strongestMetric,
    weakestMetric: thresholdEvaluation.weakestMetric,
    recommendedRuntimeLayer: !input.characterApproved
      ? "operator anime character approval"
      : truthCheck.diagnostics_match_rendered_output
        ? thresholdEvaluation.recommendedRuntimeLayer
        : "character-first renderer truth check",
    reasons,
    truthCheck,
  };
}

export function buildAnimeCharacterExecutionPlan(profileIds?: string[]): AnimeCharacterExecutionPlan {
  const approvedIds = (profileIds?.length ? profileIds : listApprovedAnimeCharacterProfiles().map((entry) => entry.id)).slice(0, ANIME_CHARACTER_MAX_PROFILES) as AnimeCharacterProfileId[];

  return {
    planId: `anime-character-plan-${approvedIds.join("-").toLowerCase()}`,
    bounded: true,
    operatorTriggeredOnly: true,
    manualApprovalRequired: true,
    characterApprovalRequired: true,
    maxProfiles: ANIME_CHARACTER_MAX_PROFILES,
    maxCastSize: 1,
    profileIds: approvedIds,
    stages: [
      "validate-character-approval",
      "validate-approved-character-profile",
      "validate-pose-expression-template",
      "snapshot-character-state",
      "snapshot-style-domain-runtime",
      "execute-character-centered-preview",
      "collect-character-diagnostics",
      "classify-character-failures",
      "restore-rollback-state-if-needed",
      "require-operator-review",
    ],
    automaticRepeatAllowed: false,
    automaticCastExpansionAllowed: false,
    autonomousCharacterBehaviorAllowed: false,
    dialogueAllowed: false,
    lipSyncAllowed: false,
    combatChoreographyAllowed: false,
    longFormRenderingAllowed: false,
    unrestrictedCostumeGenerationAllowed: false,
    unrestrictedEmotionalActingAllowed: false,
    crossRunPersistenceAllowed: false,
    runtimeMutationAllowed: false,
  };
}

export function listGovernedAnimeCharacterProfiles() {
  return listApprovedAnimeCharacterProfiles();
}

export function listGovernedAnimeCharacterPoses() {
  return listAnimeCharacterPoseTemplates();
}

export function listGovernedAnimeCharacterExpressions() {
  return listAnimeCharacterExpressionTemplates();
}

export function getAnimeCharacterRenderFormInput(profileId: string, governanceApproval: boolean): GovernedPreviewFormInput | null {
  const profile = getApprovedAnimeCharacterProfileById(profileId);
  if (!profile) {
    return null;
  }

  const pose = selectDefaultAnimeCharacterPose(profile.poseDefault);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);
  return buildCharacterFormInput({
    prompt: buildCharacterPrompt(profile),
    subject: profile.promptSubject,
    motionIntent: `${pose.motionIntent}; expression stays ${expression.label.toLowerCase()}; no dialogue or lip-sync`,
    style: buildCharacterStyle(profile),
    governanceApproval,
    packageGifPreview: true,
  });
}

function buildRenderDiagnostics(input: {
  profile: AnimeCharacterProfile;
  characterApproved: boolean;
  metrics: AnimeCharacterMetricSnapshot | null;
  rollbackRestoredCharacterRun: boolean;
  failedCharacterRenderCount: number;
  failureType: AnimeCharacterRenderDiagnostics["last_character_failure_type"];
  truthCheck: AnimeCharacterTruthCheck;
}): AnimeCharacterRenderDiagnostics | null {
  if (!input.metrics) {
    return null;
  }

  return {
    active_character_profile_id: input.profile.id,
    approved_character_execution: input.characterApproved,
    character_face_readability_score: input.metrics.characterFaceReadability,
    character_silhouette_score: input.metrics.characterSilhouette,
    character_pose_readability_score: input.metrics.characterPoseReadability,
    anime_style_identity_score: input.metrics.animeStyleIdentity,
    character_scene_integration_score: input.metrics.characterSceneIntegration,
    character_focus_priority_score: input.metrics.characterFocusPriority,
    rollback_restored_character_run: input.rollbackRestoredCharacterRun,
    failed_character_render_count: input.failedCharacterRenderCount,
    last_character_failure_type: input.failureType,
    anime_character_truth_check: input.truthCheck,
  };
}

function buildCharacterPrerequisiteState(input: {
  renderResult: AnimeCharacterVisualRenderResult;
}): Awaited<ReturnType<typeof readGovernedPreviewPrerequisiteState>> {
  return {
    micro_sequence_exists: true,
    motion_preview_ready: true,
    sandbox_path: input.renderResult.sandboxDirectory,
    sandbox_output_root: ".aie/governed_anime_character_preview_sandbox",
    generated_frame_references: input.renderResult.framePaths,
    preview_diagnostics: input.renderResult.diagnostics,
    continuity_validation: {
      valid: true,
      blockers: [],
      summary: "Character-first anime render package generated inside the governed sandbox.",
    },
    next_step_action: null,
    next_step_label: null,
  };
}

function buildCharacterMicroSequenceResult(input: {
  request: ReturnType<typeof compileGovernedPreviewRequest>;
  renderResult: AnimeCharacterVisualRenderResult;
  prerequisiteState: Awaited<ReturnType<typeof readGovernedPreviewPrerequisiteState>>;
}) {
  return {
    status: "generated" as const,
    request: input.request,
    governance_status: "Manual approval granted. Character-first anime preview remained inside sandbox boundaries.",
    sandbox_path: input.renderResult.sandboxDirectory,
    sandbox_output_root: ".aie/governed_anime_character_preview_sandbox",
    generated_frame_references: input.renderResult.framePaths.slice(0, 3),
    rollback_status: "Rollback remains limited to governed anime character sandbox outputs.",
    rollback_enabled: true as const,
    preview_diagnostics: input.renderResult.diagnostics,
    continuity_validation: input.prerequisiteState.continuity_validation,
    preview_cleanup_targets: [],
    live_workspace_blocked_output: false,
    errors: [],
    blockers: [],
    prerequisite_state: input.prerequisiteState,
  };
}

function buildCharacterPreviewExecutionResult(input: {
  request: ReturnType<typeof compileGovernedPreviewRequest>;
  renderResult: AnimeCharacterVisualRenderResult;
  prerequisiteState: Awaited<ReturnType<typeof readGovernedPreviewPrerequisiteState>>;
}) {
  return {
    status: "accepted" as const,
    request: input.request,
    governance_status: "Manual approval granted. Character-first anime preview remained inside sandbox boundaries.",
    sandbox_path: input.renderResult.sandboxDirectory,
    sandbox_output_root: ".aie/governed_anime_character_preview_sandbox",
    generated_preview_references: input.renderResult.outputFilePaths,
    manifest_file_path: input.renderResult.manifestPath,
    rollback_status: "Rollback available for governed anime character sandbox outputs.",
    rollback_enabled: true as const,
    preview_diagnostics: input.renderResult.diagnostics,
    continuity_validation: input.prerequisiteState.continuity_validation,
    execution_ledger_state: {
      ledger_id: `anime-character-ledger-${Date.now()}`,
      attempt_count: 1,
    },
    live_workspace_blocked_output: false,
    errors: [],
    blockers: [],
    prerequisite_state: input.prerequisiteState,
  };
}

export async function runGovernedAnimeCharacterRenderById(
  input: RunAnimeCharacterRenderInput,
  depsOverride?: Partial<AnimeCharacterRunnerDependencies>,
): Promise<AnimeCharacterReport> {
  const deps = resolveDependencies(depsOverride);
  const profile = getApprovedAnimeCharacterProfileById(input.characterProfileId);
  const prerequisiteBefore = await deps.readPrerequisiteState({ root: input.root, deps: input.deps });

  if (!profile) {
    return buildRejectedReport({ requestedProfileId: input.characterProfileId, characterIndex: input.characterIndex, totalCharacters: input.totalCharacters, failedCharacterRenderCount: input.failedCharacterRenderCount ?? 0, prerequisiteBefore, failureReason: `Unknown approved anime character profile: ${input.characterProfileId}`, recommendedRuntimeLayer: "anime character profile registry" });
  }

  const repeatedProfile = input.priorReports?.some((entry) => entry.characterProfileId === profile.id && entry.microSequence !== null) ?? false;
  if (repeatedProfile) {
    return buildRejectedReport({ requestedProfileId: profile.id, characterIndex: input.characterIndex, totalCharacters: input.totalCharacters, failedCharacterRenderCount: input.failedCharacterRenderCount ?? 0, prerequisiteBefore, failureReason: "Anime character renders cannot auto-repeat; clear the operator report or perform a fresh reviewed run before retrying this profile.", recommendedRuntimeLayer: "operator anime character review", profile, characterApproved: input.characterApproval });
  }

  const approvalSnapshot = buildAnimeCharacterApprovalSnapshot({ governanceApproval: input.governanceApproval, characterApproval: input.characterApproval });
  const approval = validateAnimeCharacterApproval({ governanceApproval: input.governanceApproval, characterApproval: input.characterApproval });
  if (!approval.approved) {
    return buildRejectedReport({ requestedProfileId: profile.id, characterIndex: input.characterIndex, totalCharacters: input.totalCharacters, failedCharacterRenderCount: input.failedCharacterRenderCount ?? 0, prerequisiteBefore, failureReason: approval.failureReason ?? "Anime character approval was rejected.", recommendedRuntimeLayer: approval.recommendedRuntimeLayer ?? "operator anime character approval", profile, characterApproved: false });
  }

  const pose = selectDefaultAnimeCharacterPose(profile.poseDefault);
  const expression = selectDefaultAnimeCharacterExpression(profile.expressionDefault);
  const rollbackSnapshot = {
    characterState: {
      characterProfileId: profile.id,
      characterLabel: profile.label,
      visualIdentity: [...profile.visualIdentity],
      poseTemplateId: pose.id,
      expressionTemplateId: expression.id,
    },
    styleState: {
      style: buildCharacterStyle(profile),
      animeIdentityRequired: true as const,
      maxCastSize: 1 as const,
    },
    domainState: {
      sceneRole: "character-primary-supporting-chamber" as const,
      prompt: buildCharacterPrompt(profile),
    },
    runtimeState: {
      durationSeconds: 2 as const,
      resolution: "720p" as const,
      continuityPriority: "high" as const,
      packageGifPreview: true,
    },
    diagnosticsBaseline: prerequisiteBefore.preview_diagnostics,
    approvalState: approvalSnapshot,
  };

  const formInput = getAnimeCharacterRenderFormInput(profile.id, input.governanceApproval);
  if (!formInput) {
    return buildRejectedReport({ requestedProfileId: profile.id, characterIndex: input.characterIndex, totalCharacters: input.totalCharacters, failedCharacterRenderCount: input.failedCharacterRenderCount ?? 0, prerequisiteBefore, failureReason: "Approved anime character resources could not be compiled.", recommendedRuntimeLayer: "anime character resource binding", profile, characterApproved: input.characterApproval });
  }

  const compiledRequest = deps.compileRequest(formInput);
  const renderResult = await deps.executeCharacterRenderer({
    root: input.root,
    profile,
    poseTemplate: pose,
    expressionTemplate: expression,
    packageGifPreview: true,
  });
  const prerequisiteAfter = buildCharacterPrerequisiteState({ renderResult });
  const microSequence = buildCharacterMicroSequenceResult({ request: compiledRequest, renderResult, prerequisiteState: prerequisiteAfter });
  const previewExecution = buildCharacterPreviewExecutionResult({ request: compiledRequest, renderResult, prerequisiteState: prerequisiteAfter });
  const diagnostics = renderResult.diagnostics;
  const metrics = renderResult.metrics ?? buildAnimeCharacterMetricSnapshot({ diagnostics: diagnostics ?? null, profile });
  const compatibility = evaluateAnimeCharacterCompatibility({ profile, metrics, characterApproved: approval.approved, truthCheck: renderResult.truthCheck });
  const executionBlocked = false;
  const pass = !executionBlocked && compatibility.pass;
  const rollback = pass ? null : await deps.rollbackPreviewSandbox({ root: input.root, deps: input.deps });
  const failedThresholds = executionBlocked ? [] : compatibility.failedThresholds;
  const failureAnalysis = executionBlocked
    ? { failureType: "CHARACTER_SCENE_INTEGRATION_FAILURE" as const, reason: [...microSequence.blockers, ...(previewExecution?.blockers ?? [])].join(" ") || "Governed anime character execution was blocked before preview completion.", weakestSubsystem: "preview governance", tuningDirection: "resolve preview governance blockers before continuing anime character rendering", autoRetryBlocked: true as const }
    : classifyAnimeCharacterFailure({ metrics, failedThresholds });
  const recoveryRecommendation = recommendAnimeCharacterRecovery(failureAnalysis);
  const strongestMetricName = compatibility.strongestMetric;
  const weakestMetricName = compatibility.weakestMetric;
  const strongestMetricScore = strongestMetricName && metrics ? metrics[strongestMetricName as keyof AnimeCharacterMetricSnapshot] as number : null;
  const weakestMetricScore = weakestMetricName && metrics ? metrics[weakestMetricName as keyof AnimeCharacterMetricSnapshot] as number : null;
  const failureReason = pass ? null : executionBlocked ? failureAnalysis?.reason ?? "Governed anime character rendering was blocked before preview completion." : failureAnalysis?.reason ?? compatibility.failedThresholds[0]?.reason ?? compatibility.reasons[0] ?? "Governed anime character thresholds were not met.";
  const failedCount = input.failedCharacterRenderCount ?? 0;
  const rollbackRestoredCharacterRun = rollback?.status === "rolled_back";

  return {
    characterProfileId: profile.id,
    characterLabel: profile.label,
    characterIndex: input.characterIndex,
    totalCharacters: input.totalCharacters,
    poseTemplateId: pose.id,
    poseLabel: pose.label,
    expressionTemplateId: expression.id,
    expressionLabel: expression.label,
    characterApprovalRequired: true,
    characterApproved: approval.approved,
    safetyStatus: compatibility.characterSafetyStatus === "APPROVED" && compatibility.approvalStatus === "APPROVED" ? "APPROVED" : "REJECTED",
    executionStatus: pass ? "PASSED" : "FAILED",
    pass,
    failureReason,
    compatibility,
    metrics,
    animeCharacterRenderDiagnostics: buildRenderDiagnostics({ profile, characterApproved: approval.approved, metrics, rollbackRestoredCharacterRun, failedCharacterRenderCount: failedCount + (pass ? 0 : 1), failureType: failureAnalysis?.failureType ?? null, truthCheck: renderResult.truthCheck }),
    strongestMetric: strongestMetricName,
    weakestMetric: weakestMetricName,
    strongestMetricScore,
    weakestMetricScore,
    failedThresholds,
    failureAnalysis,
    recoveryRecommendation,
    recommendedRuntimeLayer: failureAnalysis?.weakestSubsystem ?? compatibility.recommendedRuntimeLayer,
    truthCheck: renderResult.truthCheck,
    scaffoldStatus: renderResult.truthCheck.scaffold_status,
    visualReviewPackage: renderResult.visualReviewPackage,
    rollbackSnapshot,
    rollbackVisible: Boolean(rollback || diagnostics?.rollback_integrity_status),
    rollbackRestoredCharacterRun,
    characterRenderExecutionCount: (input.priorReports?.filter((entry) => entry.microSequence !== null).length ?? 0) + 1,
    failedCharacterRenderCount: failedCount,
    diagnostics: diagnostics ?? null,
    prerequisiteBefore,
    prerequisiteAfter,
    microSequence,
    previewExecution,
    rollback,
  };
}

export function summarizeGovernedAnimeCharacterReports(reports: AnimeCharacterReport[]): AnimeCharacterDiagnosticSummary {
  return summarizeAnimeCharacterDiagnostics(reports);
}

export function buildGovernedAnimeCharacterHarnessState(reports: AnimeCharacterReport[]): GovernedAnimeCharacterState | null {
  const latest = reports.at(-1);
  if (!latest) {
    return null;
  }

  return buildGovernedAnimeCharacterState({ report: latest, priorReports: reports });
}
