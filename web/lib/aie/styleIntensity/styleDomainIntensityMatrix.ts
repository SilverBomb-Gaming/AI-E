import {
  getApprovedPromptDomainTemplateById,
  listApprovedPromptDomainTemplates,
} from "../promptDomains/approvedPromptDomainTemplates";
import {
  getApprovedVisualStyleProfileById,
  listApprovedVisualStyleProfiles,
} from "../styleProfiles/approvedVisualStyleProfiles";
import type { StyleDomainIntensityMatrixCell, StyleIntensityLevel } from "./governedStyleIntensityState";
import { getStyleIntensityPreset, listStyleIntensityPresets } from "./styleIntensityPresets";

export const STYLE_INTENSITY_MAX_CELLS = 75;

const STARTER_INTENSITY_COMBINATIONS = new Set([
  "STYLE_001::DOMAIN_001::MEDIUM",
  "STYLE_002::DOMAIN_002::MEDIUM",
  "STYLE_003::DOMAIN_005::LOW",
  "STYLE_003::DOMAIN_005::MEDIUM",
  "STYLE_004::DOMAIN_004::LOW",
  "STYLE_004::DOMAIN_004::MEDIUM",
  "STYLE_005::DOMAIN_003::MEDIUM",
]);

const GUARDED_HIGH_PROBES = new Set([
  "STYLE_003::DOMAIN_005::HIGH",
  "STYLE_004::DOMAIN_004::HIGH",
]);

function buildCellId(styleId: string, domainId: string, intensityLevel: StyleIntensityLevel): string {
  return `${styleId}__${domainId}__${intensityLevel}`;
}

function buildMatrixKey(styleId: string, domainId: string, intensityLevel: StyleIntensityLevel): string {
  return `${styleId}::${domainId}::${intensityLevel}`;
}

export function listStyleDomainIntensityMatrixCells(): StyleDomainIntensityMatrixCell[] {
  const styles = listApprovedVisualStyleProfiles();
  const domains = listApprovedPromptDomainTemplates();
  const presets = listStyleIntensityPresets();

  return styles.flatMap((style) => domains.flatMap((domain) => presets.map((preset) => {
    const key = buildMatrixKey(style.id, domain.id, preset.level);
    const guardedHighProbe = GUARDED_HIGH_PROBES.has(key);

    return {
      cellId: buildCellId(style.id, domain.id, preset.level),
      styleId: style.id,
      styleLabel: style.label,
      domainId: domain.id,
      domainLabel: domain.label,
      intensityLevel: preset.level,
      intensityValue: preset.value,
      starter: STARTER_INTENSITY_COMBINATIONS.has(key),
      guardedHighProbe,
      highProbeApprovalRequired: preset.level === "HIGH",
      manualSelectionAllowed: true as const,
    };
  }))).slice(0, STYLE_INTENSITY_MAX_CELLS);
}

export function listStarterStyleIntensityCells(): StyleDomainIntensityMatrixCell[] {
  return listStyleDomainIntensityMatrixCells().filter((entry) => entry.starter);
}

export function listGuardedHighIntensityProbeCells(): StyleDomainIntensityMatrixCell[] {
  return listStyleDomainIntensityMatrixCells().filter((entry) => entry.guardedHighProbe);
}

export function getStyleDomainIntensityMatrixCellById(cellId: string): StyleDomainIntensityMatrixCell | null {
  const normalized = cellId.trim().toUpperCase();
  return listStyleDomainIntensityMatrixCells().find((entry) => entry.cellId === normalized) ?? null;
}

export function getStyleDomainIntensityCellResources(cellId: string) {
  const cell = getStyleDomainIntensityMatrixCellById(cellId);
  if (!cell) {
    return null;
  }

  const styleProfile = getApprovedVisualStyleProfileById(cell.styleId);
  const domain = getApprovedPromptDomainTemplateById(cell.domainId);
  const preset = getStyleIntensityPreset(cell.intensityLevel);
  if (!styleProfile || !domain || !preset) {
    return null;
  }

  return {
    cell,
    styleProfile,
    domain,
    preset,
  };
}
