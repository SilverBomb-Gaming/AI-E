import type { StyleIntensityLevel, StyleIntensityPreset } from "./governedStyleIntensityState";

export const STYLE_INTENSITY_LEVELS: readonly StyleIntensityLevel[] = ["LOW", "MEDIUM", "HIGH"] as const;

const STYLE_INTENSITY_PRESETS: readonly StyleIntensityPreset[] = [
  {
    level: "LOW",
    value: 0.35,
    label: "LOW",
    styleInfluence: 0.35,
    lightingAmplification: "mild",
    reflectionAmplification: "mild",
    atmosphereAmplification: "mild",
    silhouetteProtection: "strong",
    unrestricted: false,
    extremeMode: false,
  },
  {
    level: "MEDIUM",
    value: 0.65,
    label: "MEDIUM",
    styleInfluence: 0.65,
    lightingAmplification: "moderate",
    reflectionAmplification: "moderate",
    atmosphereAmplification: "moderate",
    silhouetteProtection: "strong",
    unrestricted: false,
    extremeMode: false,
  },
  {
    level: "HIGH",
    value: 0.85,
    label: "HIGH",
    styleInfluence: 0.85,
    lightingAmplification: "strong_bounded",
    reflectionAmplification: "strong_bounded",
    atmosphereAmplification: "strong_bounded",
    silhouetteProtection: "mandatory",
    unrestricted: false,
    extremeMode: false,
  },
] as const;

export function listStyleIntensityPresets(): StyleIntensityPreset[] {
  return STYLE_INTENSITY_PRESETS.map((entry) => ({ ...entry }));
}

export function getStyleIntensityPreset(level: string): StyleIntensityPreset | null {
  const normalized = level.trim().toUpperCase();
  const preset = STYLE_INTENSITY_PRESETS.find((entry) => entry.level === normalized);
  return preset ? { ...preset } : null;
}

export function isStyleIntensityLevel(value: string): value is StyleIntensityLevel {
  return STYLE_INTENSITY_LEVELS.includes(value.trim().toUpperCase() as StyleIntensityLevel);
}

export function describeStyleIntensityPreset(preset: StyleIntensityPreset): string {
  return [
    `style influence ${preset.styleInfluence}`,
    `lighting ${preset.lightingAmplification.replaceAll("_", " ")}`,
    `reflections ${preset.reflectionAmplification.replaceAll("_", " ")}`,
    `atmosphere ${preset.atmosphereAmplification.replaceAll("_", " ")}`,
    `silhouette protection ${preset.silhouetteProtection}`,
  ].join("; ");
}
