import { GOVERNED_PREVIEW_RESOLUTION, type GovernedPreviewFormInput } from "../governedPreviewGenerationContract";
import type { PromptDomainCategory } from "./governedPromptDomainRegistry";

export const PROMPT_DOMAIN_MAX_VARIANTS = 5;

export type ApprovedPromptDomainTemplate = {
  id: string;
  label: string;
  category: PromptDomainCategory;
  prompt: string;
  subject: GovernedPreviewFormInput["subject"];
  motion_intent: GovernedPreviewFormInput["motion_intent"];
  style: GovernedPreviewFormInput["style"];
  duration_seconds: GovernedPreviewFormInput["duration_seconds"];
  resolution: GovernedPreviewFormInput["resolution"];
  continuity_priority: GovernedPreviewFormInput["continuity_priority"];
  package_gif_preview: GovernedPreviewFormInput["package_gif_preview"];
};

const APPROVED_DOMAIN_TEMPLATES: readonly ApprovedPromptDomainTemplate[] = [
  {
    id: "DOMAIN_001",
    label: "ENERGY_PULSE_REACTOR",
    category: "ENERGY_PULSE",
    prompt: "A pulsing energy core glows beneath a suspended platform while two segmented drones maintain mirrored positions in a fog-filled chamber. Light reflections ripple outward, then the scene stabilizes into calm atmospheric stillness.",
    subject: "Energy core reactor drones",
    motion_intent: "Mirrored hold, light ripple, calm stabilize",
    style: "Governed energy pulse cinematic",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
  {
    id: "DOMAIN_002",
    label: "SENTRY_PLATFORM_REVEAL",
    category: "SENTRY_FORMATION",
    prompt: "Two mechanical sentry drones guard a raised beacon platform inside a dim industrial chamber. The beacon emits one controlled pulse, fog lifts along the floor, and the formation settles into a stable stance.",
    subject: "Sentry platform drones",
    motion_intent: "Guard stance, pulse response, stable settle",
    style: "Governed sentry reveal",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
  {
    id: "DOMAIN_003",
    label: "ATMOSPHERIC_APERTURE_EVENT",
    category: "ATMOSPHERIC_STAGING",
    prompt: "A glowing chamber aperture activates behind a beacon while segmented drones rotate slowly around a grounded platform. Chamber haze brightens briefly, then the scene resolves into low-light stability.",
    subject: "Aperture chamber drones",
    motion_intent: "Slow rotate, aperture activation, low-light resolve",
    style: "Governed atmospheric staging",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
  {
    id: "DOMAIN_004",
    label: "REACTIVE_REFLECTION_SEQUENCE",
    category: "ENVIRONMENTAL_REACTION",
    prompt: "A reflective floor chamber surrounds a glowing beacon while two drones sweep in synchronized arcs. The beacon pulse spreads across the floor reflections before the environment returns to calm.",
    subject: "Reflective chamber drones",
    motion_intent: "Synchronized arcs, reflection spread, calm return",
    style: "Governed reflective reaction",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
  {
    id: "DOMAIN_005",
    label: "MECHANICAL_RITUAL_ALIGNMENT",
    category: "MECHANICAL_REVEAL",
    prompt: "Segmented drones perform synchronized alignment movements around a hovering beacon in a foggy chamber. Environmental glow rises gradually, then the cinematic phrase resolves into stillness.",
    subject: "Mechanical ritual alignment drones",
    motion_intent: "Synchronized align, glow rise, stillness",
    style: "Governed mechanical alignment",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
] as const;

export function listApprovedPromptDomainTemplates(): ApprovedPromptDomainTemplate[] {
  return APPROVED_DOMAIN_TEMPLATES.map((entry) => ({ ...entry }));
}

export function getApprovedPromptDomainTemplateById(domainId: string): ApprovedPromptDomainTemplate | null {
  const normalized = domainId.trim().toUpperCase();
  const entry = APPROVED_DOMAIN_TEMPLATES.find((template) => template.id === normalized);
  return entry ? { ...entry } : null;
}