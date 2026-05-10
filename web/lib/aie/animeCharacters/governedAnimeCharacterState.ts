import type { CinematicGovernedPreviewDiagnostics } from "../cinematicProductionMemory";
import type {
  GovernedPreviewExecutionResult,
  GovernedPreviewMicroSequenceResult,
  GovernedPreviewPrerequisiteState,
  GovernedPreviewRollbackResult,
} from "../governedPreviewGeneration";

export type AnimeCharacterFailureType =
  | "FACE_READABILITY_DROP"
  | "SILHOUETTE_COLLAPSE"
  | "POSE_READABILITY_FAILURE"
  | "STYLE_IDENTITY_WEAK"
  | "EXPRESSION_INSTABILITY"
  | "BACKGROUND_COMPETITION"
  | "CHARACTER_SCENE_INTEGRATION_FAILURE"
  | "ROLLBACK_PRESSURE_SPIKE";

export type AnimeCharacterProfileId =
  | "CHARACTER_001"
  | "CHARACTER_002"
  | "CHARACTER_003"
  | "CHARACTER_004"
  | "CHARACTER_005";

export type AnimeCharacterPoseId =
  | "NEUTRAL_HERO_STANCE"
  | "HALF_TURN_REVEAL_STANCE"
  | "BEACON_FACING_CONTEMPLATIVE_STANCE"
  | "SUBTLE_ACTION_READY_STANCE"
  | "GENTLE_WALKING_APPROACH_STANCE"
  | "AFTERMATH_HOLD_STANCE";

export type AnimeCharacterExpressionId =
  | "NEUTRAL_CALM"
  | "FOCUSED_DETERMINATION"
  | "MILD_WONDER"
  | "QUIET_RESOLVE"
  | "SLIGHT_CONCERN";

export type AnimeCharacterExecutionStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED";
export type AnimeCharacterSafetyStatus = "APPROVED" | "REJECTED";
export type AnimeCharacterRendererPath = "CHARACTER_FIRST" | "FALLBACK_PRIMITIVE";
export type AnimeCharacterScaffoldStatus = "SCAFFOLD_ACTIVE" | "PARTIAL_REAL_OUTPUT" | "REAL_OUTPUT_ACTIVE";
export type AnimeCharacterVisualReviewLabel = "USER_VISUAL_CHECK_READY" | "NOT_READY_SCAFFOLD_FALLBACK_STILL_ACTIVE";

export type AnimeCharacterTruthCheck = {
  renderer_path: AnimeCharacterRendererPath;
  character_pixels_generated: boolean;
  character_primary_subject: boolean;
  fallback_primitive_dominance: boolean;
  diagnostics_match_rendered_output: boolean;
  scaffold_status: AnimeCharacterScaffoldStatus;
};

export type AnimeCharacterVisualReviewPackage = {
  reviewLabel: AnimeCharacterVisualReviewLabel;
  sandboxDirectory: string;
  firstPngToInspect: string | null;
  gifToInspect: string | null;
  manifestPath: string | null;
  diagnosticsPath: string | null;
  operatorSummaryPath: string | null;
  framePaths: string[];
  browserPreviewPaths: string[];
  characterVisible: boolean;
  faceReadable: boolean;
  eyesVisible: boolean;
  hairSilhouetteObvious: boolean;
  characterPrimarySubject: boolean;
  backgroundSupportsCharacter: boolean;
  fallbackPrimitiveDominance: boolean;
  shouldUserInspect: boolean;
  visualReviewNotes: string[];
};

export type GovernedAnimeCharacterState = {
  activeCharacterProfileId: string;
  approvedCharacterExecution: boolean;
  characterRenderExecutionCount: number;
  failedCharacterRenderCount: number;
  rollbackRestoredCharacterRun: boolean;
  lastCharacterFailureType: AnimeCharacterFailureType | null;
  scaffoldStatus: AnimeCharacterScaffoldStatus;
  rendererPath: AnimeCharacterRendererPath;
  fallbackPrimitiveDominance: boolean;
  visualReviewReady: boolean;
};

export type AnimeCharacterProfile = {
  id: AnimeCharacterProfileId;
  label: string;
  archetype: string;
  genderPresentation: "young-adult heroine" | "young-adult hero";
  eyeDescription: string;
  hairDescription: string;
  outfitDescription: string;
  expressionDefault: AnimeCharacterExpressionId;
  poseDefault: AnimeCharacterPoseId;
  promptSubject: string;
  visualIdentity: string[];
  safetyNotes: string[];
  maxCastSize: 1;
  dialogueAllowed: false;
  combatChoreographyAllowed: false;
  explicitSexualizationAllowed: false;
  unrestrictedCostumeGenerationAllowed: false;
};

export type AnimeCharacterPoseTemplate = {
  id: AnimeCharacterPoseId;
  label: string;
  motionIntent: string;
  poseReadabilityPriority: number;
  handReadabilityRequired: boolean;
  bodyBalanceRequired: boolean;
  uncontrolledLimbMotionAllowed: false;
  combatChoreographyAllowed: false;
};

export type AnimeCharacterExpressionTemplate = {
  id: AnimeCharacterExpressionId;
  label: string;
  facialReadabilityPriority: number;
  mouthPerformanceAllowed: false;
  extremeEmotionAllowed: false;
  dialogueAllowed: false;
};

export type AnimeCharacterApprovalSnapshot = {
  governanceApproval: boolean;
  characterApproval: boolean;
  approvedCharacterExecution: boolean;
  approvalRequired: true;
  approvalScope: "single-approved-anime-character-render";
  maxCastSize: 1;
  automaticRepeatAllowed: false;
  automaticCastExpansionAllowed: false;
  autonomousCharacterBehaviorAllowed: false;
  crossRunPersistenceAllowed: false;
};

export type AnimeCharacterRollbackSnapshot = {
  characterState: {
    characterProfileId: AnimeCharacterProfileId;
    characterLabel: string;
    visualIdentity: string[];
    poseTemplateId: AnimeCharacterPoseId;
    expressionTemplateId: AnimeCharacterExpressionId;
  };
  styleState: {
    style: string;
    animeIdentityRequired: true;
    maxCastSize: 1;
  };
  domainState: {
    sceneRole: "character-primary-supporting-chamber";
    prompt: string;
  };
  runtimeState: {
    durationSeconds: 1 | 2;
    resolution: "720p";
    continuityPriority: "high";
    packageGifPreview: boolean;
  };
  diagnosticsBaseline: CinematicGovernedPreviewDiagnostics | null;
  approvalState: AnimeCharacterApprovalSnapshot;
};

export type AnimeCharacterMetricSnapshot = {
  characterFaceReadability: number;
  characterSilhouette: number;
  characterPoseReadability: number;
  animeStyleIdentity: number;
  characterSceneIntegration: number;
  characterFocusPriority: number;
  previewReadability: number;
  finalComposition: number;
  expressionStability: number;
  backgroundSuppression: number;
  rollbackIntegrityStatus: "PASS" | "WATCH" | "FAIL";
  rollbackPressure: number;
};

export type AnimeCharacterRenderDiagnostics = {
  active_character_profile_id: AnimeCharacterProfileId;
  approved_character_execution: boolean;
  character_face_readability_score: number;
  character_silhouette_score: number;
  character_pose_readability_score: number;
  anime_style_identity_score: number;
  character_scene_integration_score: number;
  character_focus_priority_score: number;
  rollback_restored_character_run: boolean;
  failed_character_render_count: number;
  last_character_failure_type: AnimeCharacterFailureType | null;
  anime_character_truth_check: AnimeCharacterTruthCheck;
};

export type AnimeCharacterThresholdFailure = {
  metric: keyof AnimeCharacterMetricSnapshot;
  actual: number | string;
  required: string;
  recommendedRuntimeLayer: string;
  reason: string;
};

export type AnimeCharacterFailureAnalysis = {
  failureType: AnimeCharacterFailureType;
  reason: string;
  weakestSubsystem: string;
  tuningDirection: string;
  autoRetryBlocked: true;
};

export type AnimeCharacterRecoveryRecommendation = {
  failureType: AnimeCharacterFailureType;
  recommendation: string;
  targetLayer: string;
  autonomousTuningAllowed: false;
  operatorReviewRequired: true;
};

export type AnimeCharacterCompatibilityResult = {
  characterSafetyStatus: AnimeCharacterSafetyStatus;
  approvalStatus: AnimeCharacterSafetyStatus;
  compatibilityScore: number;
  pass: boolean;
  failedThresholds: AnimeCharacterThresholdFailure[];
  strongestMetric: string | null;
  weakestMetric: string | null;
  recommendedRuntimeLayer: string | null;
  reasons: string[];
  truthCheck: AnimeCharacterTruthCheck;
};

export type AnimeCharacterReport = {
  characterProfileId: AnimeCharacterProfileId;
  characterLabel: string;
  characterIndex: number;
  totalCharacters: number;
  poseTemplateId: AnimeCharacterPoseId;
  poseLabel: string;
  expressionTemplateId: AnimeCharacterExpressionId;
  expressionLabel: string;
  characterApprovalRequired: true;
  characterApproved: boolean;
  safetyStatus: AnimeCharacterSafetyStatus;
  executionStatus: AnimeCharacterExecutionStatus;
  pass: boolean;
  failureReason: string | null;
  compatibility: AnimeCharacterCompatibilityResult | null;
  metrics: AnimeCharacterMetricSnapshot | null;
  animeCharacterRenderDiagnostics: AnimeCharacterRenderDiagnostics | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
  strongestMetricScore: number | null;
  weakestMetricScore: number | null;
  failedThresholds: AnimeCharacterThresholdFailure[];
  failureAnalysis: AnimeCharacterFailureAnalysis | null;
  recoveryRecommendation: AnimeCharacterRecoveryRecommendation | null;
  recommendedRuntimeLayer: string | null;
  truthCheck: AnimeCharacterTruthCheck;
  scaffoldStatus: AnimeCharacterScaffoldStatus;
  visualReviewPackage: AnimeCharacterVisualReviewPackage | null;
  rollbackSnapshot: AnimeCharacterRollbackSnapshot | null;
  rollbackVisible: boolean;
  rollbackRestoredCharacterRun: boolean;
  characterRenderExecutionCount: number;
  failedCharacterRenderCount: number;
  diagnostics: CinematicGovernedPreviewDiagnostics | null;
  prerequisiteBefore: GovernedPreviewPrerequisiteState | null;
  prerequisiteAfter: GovernedPreviewPrerequisiteState | null;
  microSequence: GovernedPreviewMicroSequenceResult | null;
  previewExecution: GovernedPreviewExecutionResult | null;
  rollback: GovernedPreviewRollbackResult | null;
};

export type AnimeCharacterDiagnosticSummary = {
  testedCharacterCount: number;
  passedCharacterCount: number;
  failedCharacterCount: number;
  strongestCharacterProfileId: string | null;
  weakestCharacterProfileId: string | null;
  averageFaceReadability: number;
  averageSilhouetteClarity: number;
  averagePoseReadability: number;
  averageAnimeStyleIdentity: number;
  averageCharacterSceneIntegration: number;
  averageCharacterFocusPriority: number;
  rollbackPassRate: number;
  scaffoldStatus: AnimeCharacterScaffoldStatus;
  visualReviewReadyCount: number;
  fallbackPrimitiveDominanceCount: number;
  recommendedNextAction:
    | "CONTINUE_CHARACTER_RENDERS"
    | "TUNE_CHARACTER_FRAMING"
    | "BLOCK_CHARACTER_RENDERING";
  recommendedRuntimeLayer: string | null;
};

export type AnimeCharacterExecutionPlanStage =
  | "validate-character-approval"
  | "validate-approved-character-profile"
  | "validate-pose-expression-template"
  | "snapshot-character-state"
  | "snapshot-style-domain-runtime"
  | "execute-character-centered-preview"
  | "collect-character-diagnostics"
  | "classify-character-failures"
  | "restore-rollback-state-if-needed"
  | "require-operator-review";

export type AnimeCharacterExecutionPlan = {
  planId: string;
  bounded: true;
  operatorTriggeredOnly: true;
  manualApprovalRequired: true;
  characterApprovalRequired: true;
  maxProfiles: 5;
  maxCastSize: 1;
  profileIds: AnimeCharacterProfileId[];
  stages: AnimeCharacterExecutionPlanStage[];
  automaticRepeatAllowed: false;
  automaticCastExpansionAllowed: false;
  autonomousCharacterBehaviorAllowed: false;
  dialogueAllowed: false;
  lipSyncAllowed: false;
  combatChoreographyAllowed: false;
  longFormRenderingAllowed: false;
  unrestrictedCostumeGenerationAllowed: false;
  unrestrictedEmotionalActingAllowed: false;
  crossRunPersistenceAllowed: false;
  runtimeMutationAllowed: false;
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function buildGovernedAnimeCharacterState(input: {
  report: Pick<AnimeCharacterReport, "characterProfileId" | "characterApproved" | "rollbackRestoredCharacterRun" | "failureAnalysis" | "truthCheck" | "visualReviewPackage">;
  priorReports?: AnimeCharacterReport[];
}): GovernedAnimeCharacterState {
  const priorReports = input.priorReports ?? [];
  const failedReports = priorReports.filter((entry) => !entry.pass);

  return {
    activeCharacterProfileId: input.report.characterProfileId,
    approvedCharacterExecution: input.report.characterApproved,
    characterRenderExecutionCount: priorReports.length,
    failedCharacterRenderCount: failedReports.length,
    rollbackRestoredCharacterRun: input.report.rollbackRestoredCharacterRun,
    lastCharacterFailureType: input.report.failureAnalysis?.failureType ?? null,
    scaffoldStatus: input.report.truthCheck.scaffold_status,
    rendererPath: input.report.truthCheck.renderer_path,
    fallbackPrimitiveDominance: input.report.truthCheck.fallback_primitive_dominance,
    visualReviewReady: input.report.visualReviewPackage?.reviewLabel === "USER_VISUAL_CHECK_READY",
  };
}

export function averageAnimeCharacterMetric(reports: AnimeCharacterReport[], selector: (report: AnimeCharacterReport) => number): number {
  return average(reports.filter((entry) => entry.metrics).map(selector));
}
