import type { GovernedPreviewRequest } from "../governedPreviewGenerationContract";
import { classifyAnimeRequest, type AnimeRequestClassification } from "./animeRequestClassifier";
import { detectFallbackDominance, validateCharacterRender, type CharacterRenderValidation, type CharacterRendererAvailability, type FallbackDominanceReport } from "./fallbackDominanceDetector";
import type { CinematicGovernedPreviewDiagnostics } from "../cinematicProductionMemory";
import type { AnimeCharacterProfileId, AnimeCharacterTruthCheck } from "./governedAnimeCharacterState";

export type CharacterFirstExecutionSurface = "PREREQUISITE_MICRO_SEQUENCE" | "GOVERNED_PREVIEW" | "ANIME_CHARACTER_RENDER";

export type CharacterFirstExecutionDecision = {
  isAnimeCharacterRequest: boolean;
  classification: AnimeRequestClassification;
  requestedSurface: CharacterFirstExecutionSurface;
  availability: CharacterRendererAvailability;
  allowExecution: boolean;
  blockPrerequisiteRenderer: boolean;
  reason: string;
  blockers: string[];
};

export type AnimeCharacterProfileResolution = {
  isAnimeCharacterRequest: boolean;
  resolvedProfileId: AnimeCharacterProfileId | null;
  resolvedProfileLabel: string | null;
  resolutionStatus: "RESOLVED" | "NEEDS_OPERATOR_SELECTION" | "NOT_ANIME_CHARACTER";
  reason: string;
  classification: AnimeRequestClassification;
};

export const CHARACTER_FIRST_FALLBACK_BLOCKER = "character-first-render-required";
export const CHARACTER_FIRST_FALLBACK_REJECTION = "Character-first render required. Prerequisite beacon renderer is not a valid anime-character review artifact.";
export const CHARACTER_PROFILE_SELECTION_REQUIRED = "Anime character request detected. Please approve anime character rendering and choose a character profile.";

function classifyRequest(request: GovernedPreviewRequest): AnimeRequestClassification {
  return classifyAnimeRequest({
    prompt: request.prompt,
    subject: request.subject,
    style: request.style,
    motionIntent: request.motion_intent,
  });
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function profileResolutionText(input: { prompt?: string; subject?: string; style?: string; motionIntent?: string }): string {
  return [input.prompt, input.subject, input.style, input.motionIntent].map(normalize).join(" ");
}

export function resolveAnimeCharacterProfileForRequest(input: {
  prompt?: string;
  subject?: string;
  style?: string;
  motionIntent?: string;
}): AnimeCharacterProfileResolution {
  const classification = classifyAnimeRequest(input);
  if (!classification.isAnimeCharacterRequest) {
    return {
      isAnimeCharacterRequest: false,
      resolvedProfileId: null,
      resolvedProfileLabel: null,
      resolutionStatus: "NOT_ANIME_CHARACTER",
      reason: "Request does not contain anime-character routing intent.",
      classification,
    };
  }

  const text = profileResolutionText(input);
  const profileMatches: Array<{ id: AnimeCharacterProfileId; label: string; matched: boolean }> = [
    {
      id: "CHARACTER_001",
      label: "CELESTIAL_APPRENTICE",
      matched: /(silver[- ]blue hair|teal eyes|young woman|anime-style young woman)/.test(text),
    },
    {
      id: "CHARACTER_002",
      label: "NEON_COURIER",
      matched: /(magenta hair|neon courier|urban jacket)/.test(text),
    },
    {
      id: "CHARACTER_003",
      label: "RITUAL_TECH_ADEPT",
      matched: /(violet hair|ritual|ceremonial)/.test(text),
    },
    {
      id: "CHARACTER_004",
      label: "INDUSTRIAL_SENTINEL",
      matched: /(dark ash hair|stoic|industrial)/.test(text),
    },
  ];
  const resolved = profileMatches.find((entry) => entry.matched) ?? null;

  if (!resolved) {
    return {
      isAnimeCharacterRequest: true,
      resolvedProfileId: null,
      resolvedProfileLabel: null,
      resolutionStatus: "NEEDS_OPERATOR_SELECTION",
      reason: "Anime character request detected. Choose approved anime character profile.",
      classification,
    };
  }

  return {
    isAnimeCharacterRequest: true,
    resolvedProfileId: resolved.id,
    resolvedProfileLabel: resolved.label,
    resolutionStatus: "RESOLVED",
    reason: `Anime character request resolved to approved profile ${resolved.label}.`,
    classification,
  };
}

export function resolveCharacterFirstExecutionRoute(input: {
  request: GovernedPreviewRequest;
  requestedSurface: CharacterFirstExecutionSurface;
  characterRendererAvailability?: CharacterRendererAvailability;
}): CharacterFirstExecutionDecision {
  const classification = classifyRequest(input.request);
  const availability = input.characterRendererAvailability ?? "AVAILABLE";

  if (!classification.isAnimeCharacterRequest) {
    return {
      isAnimeCharacterRequest: false,
      classification,
      requestedSurface: input.requestedSurface,
      availability,
      allowExecution: true,
      blockPrerequisiteRenderer: false,
      reason: "Request does not contain anime-character routing intent.",
      blockers: [],
    };
  }

  if (input.requestedSurface === "ANIME_CHARACTER_RENDER" && availability === "AVAILABLE") {
    return {
      isAnimeCharacterRequest: true,
      classification,
      requestedSurface: input.requestedSurface,
      availability,
      allowExecution: true,
      blockPrerequisiteRenderer: false,
      reason: "Anime-character request is routed to the character-first renderer.",
      blockers: [],
    };
  }

  const availabilityReason = availability === "AVAILABLE"
    ? CHARACTER_FIRST_FALLBACK_REJECTION
    : "Character renderer unavailable. Prerequisite beacon renderer blocked for anime-character requests.";

  return {
    isAnimeCharacterRequest: true,
    classification,
    requestedSurface: input.requestedSurface,
    availability,
    allowExecution: false,
    blockPrerequisiteRenderer: true,
    reason: availabilityReason,
    blockers: [CHARACTER_FIRST_FALLBACK_BLOCKER],
  };
}

export function buildInvalidFallbackReviewDecision(input: {
  diagnostics?: Partial<CinematicGovernedPreviewDiagnostics> | null;
  artifactPaths?: string[];
  truthCheck?: Partial<AnimeCharacterTruthCheck> | null;
}): {
  fallbackReport: FallbackDominanceReport;
  validation: CharacterRenderValidation;
  reviewAllowed: boolean;
  reason: string;
} {
  const fallbackReport = detectFallbackDominance(input);
  const validation = validateCharacterRender({ fallbackReport, truthCheck: input.truthCheck, diagnostics: input.diagnostics });

  return {
    fallbackReport,
    validation,
    reviewAllowed: validation.validationPassed,
    reason: validation.validationPassed
      ? "Character render validation passed; visual review may proceed."
      : "Invalid review artifact. Fallback prerequisite renderer detected for anime-character request.",
  };
}
