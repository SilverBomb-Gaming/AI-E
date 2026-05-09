import type { ApprovedVisualStyleProfile } from "../styleProfiles/approvedVisualStyleProfiles";
import type { HighIntensityVisualCaps } from "./governedHighIntensityState";

const DEFAULT_CAPS: Omit<HighIntensityVisualCaps, "styleId" | "styleLabel" | "capProfileId" | "visibleCaps"> = {
  silhouetteProtection: 0.95,
  glowBloomCap: 0.72,
  edgeSofteningCap: 0.55,
  reflectionAmplificationCap: 0.7,
  atmosphereDensityCap: 0.7,
  materialDetailDensityCap: 0.7,
  focusReadabilityFloor: 0.95,
  objectSeparationFloor: 0.95,
  deterministic: true,
  operatorVisible: true,
  mutationAllowed: false,
};

export function buildHighIntensityVisualCaps(styleProfile: ApprovedVisualStyleProfile): HighIntensityVisualCaps {
  if (styleProfile.id === "STYLE_003") {
    return {
      ...DEFAULT_CAPS,
      styleId: styleProfile.id,
      styleLabel: styleProfile.label,
      capProfileId: "anime-inspired-high-caps",
      glowBloomCap: 0.62,
      edgeSofteningCap: 0.48,
      reflectionAmplificationCap: 0.58,
      atmosphereDensityCap: 0.64,
      materialDetailDensityCap: 0.54,
      visibleCaps: [
        "preserve silhouette readability",
        "cap glow bloom",
        "cap edge softening",
        "preserve object separation",
      ],
    };
  }

  if (styleProfile.id === "STYLE_004") {
    return {
      ...DEFAULT_CAPS,
      styleId: styleProfile.id,
      styleLabel: styleProfile.label,
      capProfileId: "neon-dystopian-high-caps",
      glowBloomCap: 0.6,
      edgeSofteningCap: 0.52,
      reflectionAmplificationCap: 0.58,
      atmosphereDensityCap: 0.66,
      materialDetailDensityCap: 0.64,
      visibleCaps: [
        "cap glow stacking",
        "cap reflection amplification",
        "preserve focus readability",
        "preserve subject visibility",
      ],
    };
  }

  if (styleProfile.id === "STYLE_005") {
    return {
      ...DEFAULT_CAPS,
      styleId: styleProfile.id,
      styleLabel: styleProfile.label,
      capProfileId: "atmospheric-painterly-high-caps",
      glowBloomCap: 0.66,
      edgeSofteningCap: 0.44,
      reflectionAmplificationCap: 0.54,
      atmosphereDensityCap: 0.62,
      materialDetailDensityCap: 0.52,
      visibleCaps: [
        "preserve edge clarity",
        "preserve object permanence",
        "prevent over-smearing",
        "preserve environmental identity",
      ],
    };
  }

  if (styleProfile.id === "STYLE_002") {
    return {
      ...DEFAULT_CAPS,
      styleId: styleProfile.id,
      styleLabel: styleProfile.label,
      capProfileId: "industrial-realism-high-caps",
      glowBloomCap: 0.5,
      edgeSofteningCap: 0.36,
      reflectionAmplificationCap: 0.52,
      atmosphereDensityCap: 0.5,
      materialDetailDensityCap: 0.58,
      visibleCaps: [
        "cap material detail density",
        "suppress texture noise",
        "preserve composition readability",
        "preserve lighting focus",
      ],
    };
  }

  return {
    ...DEFAULT_CAPS,
    styleId: styleProfile.id,
    styleLabel: styleProfile.label,
    capProfileId: "generic-high-caps",
    visibleCaps: [
      "preserve cinematic readability",
      "cap visual amplification",
      "preserve rollback-safe preview boundaries",
    ],
  };
}

export function describeHighIntensityVisualCaps(caps: HighIntensityVisualCaps): string {
  return `${caps.capProfileId}: ${caps.visibleCaps.join("; ")}`;
}
