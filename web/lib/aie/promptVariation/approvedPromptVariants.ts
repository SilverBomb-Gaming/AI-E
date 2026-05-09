import { GOVERNED_PREVIEW_RESOLUTION, type GovernedPreviewFormInput } from "../governedPreviewGenerationContract";
import type { PromptVariationDomain } from "./promptVariationHarnessState";

export const PROMPT_VARIATION_MAX_VARIANTS = 4;

export type ApprovedPromptVariant = {
  id: string;
  label: string;
  domain: PromptVariationDomain;
  prompt: string;
  subject: GovernedPreviewFormInput["subject"];
  motion_intent: GovernedPreviewFormInput["motion_intent"];
  style: GovernedPreviewFormInput["style"];
  duration_seconds: GovernedPreviewFormInput["duration_seconds"];
  resolution: GovernedPreviewFormInput["resolution"];
  continuity_priority: GovernedPreviewFormInput["continuity_priority"];
  package_gif_preview: GovernedPreviewFormInput["package_gif_preview"];
};

const APPROVED_VARIANTS: readonly ApprovedPromptVariant[] = [
  {
    id: "VARIANT_001",
    label: "BASELINE_BEACON_CHAMBER",
    domain: "SCI_FI_BEACON_CHAMBER",
    prompt: "Two segmented drones circle a glowing beacon in a foggy sci-fi chamber. The beacon pulses once, the drones react in formation, the chamber glow intensifies, then the scene settles into a calm aftermath.",
    subject: "Segmented beacon chamber drones",
    motion_intent: "Circle, pulse reaction, calm settle",
    style: "Governed sci-fi cinematic",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
  {
    id: "VARIANT_002",
    label: "DRONE_ORBIT_REVEAL",
    domain: "DRONE_FORMATION_REVEAL",
    prompt: "Two segmented drones orbit a central beacon above a grounded platform in a dark sci-fi chamber. The beacon flashes once, the drones widen formation, fog lifts around the floor, then the shot settles calmly.",
    subject: "Orbiting segmented drones",
    motion_intent: "Orbit, widen formation, settle",
    style: "Governed chamber reveal",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
  {
    id: "VARIANT_003",
    label: "CHAMBER_LIGHT_RESPONSE",
    domain: "ENVIRONMENTAL_PULSE_REACTION",
    prompt: "A glowing beacon activates inside a foggy mechanical chamber while two segmented drones hold mirrored positions. The chamber light rises, drone arms tilt toward the beacon, and the environment eases back to stillness.",
    subject: "Mirrored beacon chamber drones",
    motion_intent: "Activation, mirrored response, stillness",
    style: "Governed environmental response",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
  {
    id: "VARIANT_004",
    label: "MECHANICAL_RITUAL_PULSE",
    domain: "MECHANICAL_RITUAL_STAGING",
    prompt: "Two mechanical drones perform a synchronized formation around a pulsing beacon in a dim chamber. The beacon glow peaks, reflections spread across the floor, then the drones return to a stable sentry formation.",
    subject: "Mechanical ritual drones",
    motion_intent: "Synchronized formation, pulse peak, sentry settle",
    style: "Governed mechanical ritual",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
] as const;

export function listApprovedPromptVariants(): ApprovedPromptVariant[] {
  return APPROVED_VARIANTS.map((variant) => ({ ...variant }));
}

export function getApprovedPromptVariantById(variantId: string): ApprovedPromptVariant | null {
  const normalized = variantId.trim().toUpperCase();
  const variant = APPROVED_VARIANTS.find((entry) => entry.id === normalized);
  return variant ? { ...variant } : null;
}