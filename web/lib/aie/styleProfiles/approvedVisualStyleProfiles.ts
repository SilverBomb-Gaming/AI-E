import { GOVERNED_PREVIEW_RESOLUTION, type GovernedPreviewFormInput } from "../governedPreviewGenerationContract";
import type { VisualStyleCategory } from "./governedVisualStyleRegistry";

export const VISUAL_STYLE_MAX_PROFILES = 5;

export type ApprovedVisualStyleProfile = {
  id: string;
  label: string;
  category: VisualStyleCategory;
  characteristics: string[];
  description: string;
  prompt: GovernedPreviewFormInput["prompt"];
  subject: GovernedPreviewFormInput["subject"];
  motion_intent: GovernedPreviewFormInput["motion_intent"];
  style: GovernedPreviewFormInput["style"];
  duration_seconds: GovernedPreviewFormInput["duration_seconds"];
  resolution: GovernedPreviewFormInput["resolution"];
  continuity_priority: GovernedPreviewFormInput["continuity_priority"];
  package_gif_preview: GovernedPreviewFormInput["package_gif_preview"];
};

const BASELINE_PROMPT = "Two segmented drones circle a glowing beacon in a foggy sci-fi chamber. The beacon pulses once, the drones react in formation, the chamber glow intensifies, then the scene settles into a calm aftermath.";
const BASELINE_SUBJECT = "Segmented beacon chamber drones";
const BASELINE_MOTION = "Circle, pulse reaction, calm settle";

const APPROVED_VISUAL_STYLE_PROFILES: readonly ApprovedVisualStyleProfile[] = [
  {
    id: "STYLE_001",
    label: "CINEMATIC_SCI_FI",
    category: "CINEMATIC_SCI_FI",
    characteristics: [
      "balanced cinematic lighting",
      "grounded chamber realism",
      "moderate atmospheric fog",
      "readable reflections",
      "stable composition",
      "filmic contrast",
    ],
    description: "Balanced chamber cinematography with grounded sci-fi realism and controlled atmospheric glow.",
    prompt: BASELINE_PROMPT,
    subject: BASELINE_SUBJECT,
    motion_intent: BASELINE_MOTION,
    style: "Governed cinematic sci-fi",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
  {
    id: "STYLE_002",
    label: "INDUSTRIAL_REALISM",
    category: "INDUSTRIAL_REALISM",
    characteristics: [
      "metallic material emphasis",
      "stronger environmental texture detail",
      "grounded industrial lighting",
      "subtle reflections",
      "reduced stylization",
      "realism-focused readability",
    ],
    description: "Industrial realism keeps surfaces grounded and readable without escalating into unrestricted realism.",
    prompt: BASELINE_PROMPT,
    subject: BASELINE_SUBJECT,
    motion_intent: BASELINE_MOTION,
    style: "Governed industrial realism",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
  {
    id: "STYLE_003",
    label: "ANIME_INSPIRED",
    category: "ANIME_INSPIRED",
    characteristics: [
      "simplified material shading",
      "high silhouette readability",
      "stronger color separation",
      "softer atmospheric gradients",
      "stylized cinematic glow",
      "controlled cel-style influence",
    ],
    description: "Anime-inspired chamber rendering with readability-first stylization and explicit non-humanoid safeguards.",
    prompt: BASELINE_PROMPT,
    subject: BASELINE_SUBJECT,
    motion_intent: BASELINE_MOTION,
    style: "Governed anime-inspired chamber",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
  {
    id: "STYLE_004",
    label: "NEON_DYSTOPIAN",
    category: "NEON_DYSTOPIAN",
    characteristics: [
      "neon chamber lighting",
      "high contrast reflections",
      "atmospheric haze emphasis",
      "reactive glow layering",
      "cinematic cyberpunk-inspired readability",
    ],
    description: "Neon dystopian chamber lighting that stays readable and bounded instead of escalating into uncontrolled glow noise.",
    prompt: BASELINE_PROMPT,
    subject: BASELINE_SUBJECT,
    motion_intent: BASELINE_MOTION,
    style: "Governed neon dystopian chamber",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
  {
    id: "STYLE_005",
    label: "ATMOSPHERIC_PAINTERLY",
    category: "ATMOSPHERIC_PAINTERLY",
    characteristics: [
      "softened reflections",
      "painterly environmental blending",
      "diffuse lighting",
      "atmospheric emphasis",
      "stylized cinematic softness",
    ],
    description: "Painterly atmospheric blending that softens the chamber look without breaking continuity or readability.",
    prompt: BASELINE_PROMPT,
    subject: BASELINE_SUBJECT,
    motion_intent: BASELINE_MOTION,
    style: "Governed atmospheric painterly",
    duration_seconds: 2,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: "high",
    package_gif_preview: true,
  },
] as const;

export function listApprovedVisualStyleProfiles(): ApprovedVisualStyleProfile[] {
  return APPROVED_VISUAL_STYLE_PROFILES.map((entry) => ({
    ...entry,
    characteristics: [...entry.characteristics],
  }));
}

export function getApprovedVisualStyleProfileById(styleId: string): ApprovedVisualStyleProfile | null {
  const normalized = styleId.trim().toUpperCase();
  const entry = APPROVED_VISUAL_STYLE_PROFILES.find((profile) => profile.id === normalized);
  return entry
    ? { ...entry, characteristics: [...entry.characteristics] }
    : null;
}