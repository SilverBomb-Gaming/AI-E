import type { CinematicGovernedPreviewDiagnostics } from "../cinematicProductionMemory";
import type { AnimeCharacterTruthCheck } from "./governedAnimeCharacterState";

export type DominantFallbackType = "BEACON" | "CUBE" | "SEGMENTED_DRONES" | "PLACEHOLDER_STAGING" | null;

export type FallbackDominanceReport = {
  fallbackDetected: boolean;
  dominantFallbackType: DominantFallbackType;
  characterPresenceScore: number;
  faceReadabilityScore: number;
  silhouetteReadabilityScore: number;
  validCharacterRender: boolean;
  detectedSignals: string[];
};

export type CharacterRendererAvailability = "AVAILABLE" | "BLOCKED" | "NOT_IMPLEMENTED" | "FALLBACK_ONLY";

export type CharacterRenderValidation = {
  humanoidDetected: boolean;
  faceReadable: boolean;
  silhouetteReadable: boolean;
  characterPrimarySubject: boolean;
  animeStyleDominant: boolean;
  validationPassed: boolean;
  failureReasons: string[];
};

function normalize(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(normalize).join(" ");
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(normalize).join(" ");
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value).toLowerCase() : "";
}

function score(value: boolean, passScore: number): number {
  return value ? passScore : 0;
}

export function detectFallbackDominance(input: {
  diagnostics?: Partial<CinematicGovernedPreviewDiagnostics> | null;
  artifactPaths?: string[];
  truthCheck?: Partial<AnimeCharacterTruthCheck> | null;
}): FallbackDominanceReport {
  const artifactText = normalize(input.artifactPaths ?? []);
  const diagnosticText = normalize(input.diagnostics ?? {});
  const truthCheck = input.truthCheck ?? null;
  const combined = `${artifactText} ${diagnosticText}`;
  const detectedSignals: string[] = [];
  const trustworthyCharacterTruth = truthCheck?.renderer_path === "CHARACTER_FIRST"
    && truthCheck.character_pixels_generated === true
    && truthCheck.character_primary_subject === true
    && truthCheck.fallback_primitive_dominance === false
    && truthCheck.diagnostics_match_rendered_output === true;

  const fallbackArtifactDetected = /governed_preview_sequence|governed_motion_preview/.test(artifactText);
  const beaconDetected = !trustworthyCharacterTruth && /\bbeacon\b|beacon_reveal/.test(combined);
  const cubeDetected = !trustworthyCharacterTruth && /\bcube\b|cube anchor|anchored cube/.test(combined);
  const droneDetected = !trustworthyCharacterTruth && /segmented drone|dual_orbit|dual orbit|\bdrone\b/.test(combined);
  const placeholderDetected = fallbackArtifactDetected
    || (!trustworthyCharacterTruth && /placeholder|primitive renderer|fallback/.test(combined))
    || truthCheck?.renderer_path === "FALLBACK_PRIMITIVE"
    || truthCheck?.fallback_primitive_dominance === true;

  if (beaconDetected) {
    detectedSignals.push("beacon-dominance");
  }
  if (cubeDetected) {
    detectedSignals.push("cube-dominance");
  }
  if (droneDetected) {
    detectedSignals.push("segmented-drone-dominance");
  }
  if (placeholderDetected) {
    detectedSignals.push("placeholder-staging");
  }

  const dominantFallbackType: DominantFallbackType = droneDetected
    ? "SEGMENTED_DRONES"
    : cubeDetected
      ? "CUBE"
      : beaconDetected
        ? "BEACON"
        : placeholderDetected
          ? "PLACEHOLDER_STAGING"
          : null;
  const characterPrimary = truthCheck?.character_primary_subject === true || /anime_character|character_face|character silhouette|character-first/.test(combined);
  const diagnosticsMatch = truthCheck?.diagnostics_match_rendered_output === true || /anime character visibly dominates|character-first frame/.test(combined);
  const fallbackDetected = dominantFallbackType !== null;
  const characterPresenceScore = score(characterPrimary && !fallbackDetected, 96);
  const faceReadabilityScore = score(diagnosticsMatch && !fallbackDetected, 95);
  const silhouetteReadabilityScore = score((truthCheck?.character_pixels_generated === true || diagnosticsMatch) && !fallbackDetected, 95);

  return {
    fallbackDetected,
    dominantFallbackType,
    characterPresenceScore,
    faceReadabilityScore,
    silhouetteReadabilityScore,
    validCharacterRender: !fallbackDetected && characterPresenceScore >= 95 && faceReadabilityScore >= 95 && silhouetteReadabilityScore >= 95,
    detectedSignals,
  };
}

export function validateCharacterRender(input: {
  fallbackReport: FallbackDominanceReport;
  truthCheck?: Partial<AnimeCharacterTruthCheck> | null;
  diagnostics?: Partial<CinematicGovernedPreviewDiagnostics> | null;
}): CharacterRenderValidation {
  const diagnosticText = normalize(input.diagnostics ?? {});
  const truthCheck = input.truthCheck ?? null;
  const humanoidDetected = truthCheck?.character_pixels_generated === true || /anime_character|character face|humanoid|young woman|young man/.test(diagnosticText);
  const faceReadable = input.fallbackReport.faceReadabilityScore >= 95 || /character_face|face readability|large .*eyes/.test(diagnosticText);
  const silhouetteReadable = input.fallbackReport.silhouetteReadabilityScore >= 95 || /silhouette/.test(diagnosticText);
  const characterPrimarySubject = truthCheck?.character_primary_subject === true || /primary rendered subject|character-first|character visibly dominates/.test(diagnosticText);
  const animeStyleDominant = /anime|cel-style|manga/.test(diagnosticText);
  const failureReasons = [
    !humanoidDetected ? "No humanoid/anime character pixels detected." : null,
    !faceReadable ? "Character face readability is below threshold." : null,
    !silhouetteReadable ? "Character silhouette readability is below threshold." : null,
    !characterPrimarySubject ? "Character is not the primary subject." : null,
    !animeStyleDominant ? "Anime style dominance is not visible in diagnostics." : null,
    input.fallbackReport.fallbackDetected ? `Fallback prerequisite renderer detected: ${input.fallbackReport.dominantFallbackType}.` : null,
  ].filter((reason): reason is string => Boolean(reason));

  return {
    humanoidDetected,
    faceReadable,
    silhouetteReadable,
    characterPrimarySubject,
    animeStyleDominant,
    validationPassed: failureReasons.length === 0,
    failureReasons,
  };
}
