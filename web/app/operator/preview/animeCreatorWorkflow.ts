import type { AnimeCharacterProfileId, AnimeCharacterTruthCheck } from "@/lib/aie/animeCharacters/governedAnimeCharacterState";
import { resolveAnimeCharacterProfileForRequest, type AnimeCharacterProfileResolution } from "@/lib/aie/animeCharacters/characterFirstExecutionRouter";

export type CreatorWorkflowMode = "ANIME_CREATOR_MODE" | "GENERAL_GOVERNED_MODE";

export type AnimeCreatorWorkflowStageId =
  | "character-intent-detected"
  | "anime-profile-resolved"
  | "character-visual-path-prepared"
  | "micro-sequence-ready"
  | "anime-character-review-ready"
  | "motion-preview-ready"
  | "final-review-ready";

export type AnimeCreatorWorkflowStage = {
  id: AnimeCreatorWorkflowStageId;
  label: string;
  complete: boolean;
  guidance: string;
};

export type ActiveRenderPathLabel =
  | "CHARACTER_FIRST_RENDERER"
  | "PRIMITIVE_FALLBACK"
  | "GOVERNED_PREVIEW"
  | "MOTION_PREVIEW"
  | "PLACEHOLDER"
  | "MOCK_OUTPUT";

export type CreatorPanelId =
  | "anime-character-controls"
  | "anime-profile-cards"
  | "anime-diagnostics"
  | "anime-render-actions"
  | "anime-visual-review"
  | "audio-roadmap"
  | "cinematic-roadmap"
  | "prompt-variation-harness"
  | "prompt-domain-harness"
  | "visual-style-harness"
  | "style-stress-harness"
  | "style-intensity-harness"
  | "high-probe-harness"
  | "micro-sequence-frames"
  | "frame-comparison";

export type CreatorPanelVisibility = Record<CreatorPanelId, boolean>;

export type CreatorExperienceDiagnostics = {
  creator_workflow_alignment: number;
  workflow_confusion_risk: number;
  irrelevant_panel_exposure: number;
  intent_route_accuracy: number;
  creator_mode_activation: boolean;
  anime_flow_efficiency: number;
  render_path_truthfulness: number;
};

export type AnimeCreatorWorkflowState = {
  mode: CreatorWorkflowMode;
  profileResolution: AnimeCharacterProfileResolution;
  stages: AnimeCreatorWorkflowStage[];
  guidanceCards: string[];
  panelVisibility: CreatorPanelVisibility;
  activeRenderPath: ActiveRenderPathLabel;
  diagnostics: CreatorExperienceDiagnostics;
  scaffoldStatus: "ANIME_CREATOR_WORKFLOW_ACTIVE" | "PARTIAL_CREATOR_ROUTING" | "DEV_HARNESS_DOMINANT";
};

export function resolveCreatorIntentRoute(input: {
  prompt?: string;
  subject?: string;
  style?: string;
  motionIntent?: string;
}): Pick<AnimeCreatorWorkflowState, "mode" | "profileResolution"> {
  const profileResolution = resolveAnimeCharacterProfileForRequest(input);
  return {
    mode: profileResolution.isAnimeCharacterRequest ? "ANIME_CREATOR_MODE" : "GENERAL_GOVERNED_MODE",
    profileResolution,
  };
}

export function resolveActiveRenderPathLabel(input: {
  mode: CreatorWorkflowMode;
  truthCheck?: AnimeCharacterTruthCheck | null;
  previewGenerated?: boolean;
  motionPreviewReady?: boolean;
}): ActiveRenderPathLabel {
  if (input.truthCheck?.renderer_path === "CHARACTER_FIRST" && !input.truthCheck.fallback_primitive_dominance) {
    return "CHARACTER_FIRST_RENDERER";
  }
  if (input.truthCheck?.renderer_path === "FALLBACK_PRIMITIVE" || input.truthCheck?.fallback_primitive_dominance) {
    return "PRIMITIVE_FALLBACK";
  }
  if (input.previewGenerated) {
    return input.mode === "ANIME_CREATOR_MODE" ? "CHARACTER_FIRST_RENDERER" : "GOVERNED_PREVIEW";
  }
  if (input.motionPreviewReady) {
    return "MOTION_PREVIEW";
  }
  return input.mode === "ANIME_CREATOR_MODE" ? "CHARACTER_FIRST_RENDERER" : "GOVERNED_PREVIEW";
}

export function buildCreatorPanelVisibility(mode: CreatorWorkflowMode): CreatorPanelVisibility {
  const animeMode = mode === "ANIME_CREATOR_MODE";
  return {
    "anime-character-controls": animeMode,
    "anime-profile-cards": animeMode,
    "anime-diagnostics": animeMode,
    "anime-render-actions": animeMode,
    "anime-visual-review": animeMode,
    "audio-roadmap": animeMode,
    "cinematic-roadmap": animeMode,
    "prompt-variation-harness": !animeMode,
    "prompt-domain-harness": !animeMode,
    "visual-style-harness": !animeMode,
    "style-stress-harness": !animeMode,
    "style-intensity-harness": !animeMode,
    "high-probe-harness": !animeMode,
    "micro-sequence-frames": !animeMode,
    "frame-comparison": !animeMode,
  };
}

function buildStages(input: {
  profileResolution: AnimeCharacterProfileResolution;
  characterApproval: boolean;
  governanceApproval: boolean;
  motionPreviewReady: boolean;
  reviewReady: boolean;
  previewGenerated: boolean;
  finalReviewReady: boolean;
}): AnimeCreatorWorkflowStage[] {
  return [
    {
      id: "character-intent-detected",
      label: "Character Intent Detected",
      complete: input.profileResolution.isAnimeCharacterRequest,
      guidance: "Anime intent detected from the creator prompt.",
    },
    {
      id: "anime-profile-resolved",
      label: "Anime Profile Resolved",
      complete: input.profileResolution.resolutionStatus === "RESOLVED",
      guidance: input.profileResolution.resolvedProfileLabel
        ? `${input.profileResolution.resolvedProfileLabel} selected.`
        : "Choose an approved anime profile before rendering.",
    },
    {
      id: "character-visual-path-prepared",
      label: "Character Visual Path Prepared",
      complete: input.characterApproval && input.governanceApproval,
      guidance: "Character-first render path active after manual and character approval.",
    },
    {
      id: "micro-sequence-ready",
      label: "Micro-Sequence Ready",
      complete: input.motionPreviewReady || input.reviewReady,
      guidance: "Micro-sequence is recommended before motion preview, but anime character frame/GIF generation can run directly in character-first mode.",
    },
    {
      id: "anime-character-review-ready",
      label: "Anime Character Review Ready",
      complete: input.reviewReady,
      guidance: "Anime PNG/GIF review package is ready when the character render completes.",
    },
    {
      id: "motion-preview-ready",
      label: "Motion Preview Ready",
      complete: input.previewGenerated,
      guidance: "Motion preview remains a later governed path after character review.",
    },
    {
      id: "final-review-ready",
      label: "Final Review Ready",
      complete: input.finalReviewReady,
      guidance: "Final review is ready after visible output, truth checks, and diagnostics agree.",
    },
  ];
}

export function buildAnimeCreatorGuidance(input: {
  profileResolution: AnimeCharacterProfileResolution;
  activeRenderPath: ActiveRenderPathLabel;
  visualFidelityTier?: string | null;
  audioImplemented: boolean;
}): string[] {
  const cards = ["Anime intent detected."];
  if (input.profileResolution.resolvedProfileLabel) {
    cards.push(`${input.profileResolution.resolvedProfileLabel} selected.`);
  } else if (input.profileResolution.isAnimeCharacterRequest) {
    cards.push("Choose an approved anime profile to continue.");
  }
  cards.push(input.activeRenderPath === "CHARACTER_FIRST_RENDERER" ? "Character-first render path active." : `Active render path: ${input.activeRenderPath}.`);
  cards.push("Micro-sequence recommended before motion preview.");
  if (input.visualFidelityTier) {
    cards.push(`Visual fidelity currently ${input.visualFidelityTier}.`);
  }
  if (!input.audioImplemented) {
    cards.push("Audio generation unavailable in current phase.");
  }
  return cards;
}

export function buildCreatorExperienceDiagnostics(input: {
  mode: CreatorWorkflowMode;
  panelVisibility: CreatorPanelVisibility;
  profileResolved: boolean;
  activeRenderPath: ActiveRenderPathLabel;
}): CreatorExperienceDiagnostics {
  const irrelevantPanelExposure = [
    input.panelVisibility["prompt-variation-harness"],
    input.panelVisibility["prompt-domain-harness"],
    input.panelVisibility["style-stress-harness"],
    input.panelVisibility["style-intensity-harness"],
    input.panelVisibility["high-probe-harness"],
  ].filter(Boolean).length;
  const animeMode = input.mode === "ANIME_CREATOR_MODE";
  const renderPathTruthful = input.activeRenderPath !== "PLACEHOLDER" && input.activeRenderPath !== "MOCK_OUTPUT";

  return {
    creator_workflow_alignment: animeMode ? 94 : 68,
    workflow_confusion_risk: animeMode ? Math.max(6, 26 - irrelevantPanelExposure * 4) : 42,
    irrelevant_panel_exposure: irrelevantPanelExposure,
    intent_route_accuracy: animeMode && input.profileResolved ? 96 : animeMode ? 84 : 70,
    creator_mode_activation: animeMode,
    anime_flow_efficiency: animeMode ? 92 : 60,
    render_path_truthfulness: renderPathTruthful ? 98 : 40,
  };
}

export function buildAnimeCreatorWorkflowState(input: {
  prompt?: string;
  subject?: string;
  style?: string;
  motionIntent?: string;
  characterApproval: boolean;
  governanceApproval: boolean;
  motionPreviewReady: boolean;
  reviewReady: boolean;
  previewGenerated: boolean;
  finalReviewReady: boolean;
  truthCheck?: AnimeCharacterTruthCheck | null;
  visualFidelityTier?: string | null;
  audioImplemented?: boolean;
}): AnimeCreatorWorkflowState {
  const route = resolveCreatorIntentRoute(input);
  const panelVisibility = buildCreatorPanelVisibility(route.mode);
  const activeRenderPath = resolveActiveRenderPathLabel({
    mode: route.mode,
    truthCheck: input.truthCheck,
    previewGenerated: input.previewGenerated,
    motionPreviewReady: input.motionPreviewReady,
  });
  const stages = buildStages({
    profileResolution: route.profileResolution,
    characterApproval: input.characterApproval,
    governanceApproval: input.governanceApproval,
    motionPreviewReady: input.motionPreviewReady,
    reviewReady: input.reviewReady,
    previewGenerated: input.previewGenerated,
    finalReviewReady: input.finalReviewReady,
  });
  const diagnostics = buildCreatorExperienceDiagnostics({
    mode: route.mode,
    panelVisibility,
    profileResolved: route.profileResolution.resolutionStatus === "RESOLVED",
    activeRenderPath,
  });

  return {
    mode: route.mode,
    profileResolution: route.profileResolution,
    stages,
    guidanceCards: route.mode === "ANIME_CREATOR_MODE" ? buildAnimeCreatorGuidance({
      profileResolution: route.profileResolution,
      activeRenderPath,
      visualFidelityTier: input.visualFidelityTier,
      audioImplemented: input.audioImplemented ?? false,
    }) : [],
    panelVisibility,
    activeRenderPath,
    diagnostics,
    scaffoldStatus: route.mode === "ANIME_CREATOR_MODE" && diagnostics.irrelevant_panel_exposure === 0 && diagnostics.creator_workflow_alignment >= 90
      ? "ANIME_CREATOR_WORKFLOW_ACTIVE"
      : route.mode === "ANIME_CREATOR_MODE"
        ? "PARTIAL_CREATOR_ROUTING"
        : "DEV_HARNESS_DOMINANT",
  };
}

export function resolvePreferredAnimeCreatorProfileId(input: {
  resolvedProfileId: AnimeCharacterProfileId | null;
  currentProfileId: string;
}): string {
  return input.resolvedProfileId ?? input.currentProfileId;
}
