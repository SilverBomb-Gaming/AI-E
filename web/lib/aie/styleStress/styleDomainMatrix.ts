import {
  getApprovedPromptDomainTemplateById,
  listApprovedPromptDomainTemplates,
} from "../promptDomains/approvedPromptDomainTemplates";
import {
  getApprovedVisualStyleProfileById,
  listApprovedVisualStyleProfiles,
} from "../styleProfiles/approvedVisualStyleProfiles";
import type { StyleStressMatrixCell } from "./governedStyleStressState";

export const STYLE_STRESS_MAX_CELLS = 25;

const STARTER_COMBINATIONS = new Set([
  "STYLE_001::DOMAIN_001",
  "STYLE_002::DOMAIN_002",
  "STYLE_003::DOMAIN_005",
  "STYLE_004::DOMAIN_004",
  "STYLE_005::DOMAIN_003",
]);

function buildCellId(styleId: string, domainId: string): string {
  return `${styleId}__${domainId}`;
}

export function listStyleStressMatrixCells(): StyleStressMatrixCell[] {
  const styles = listApprovedVisualStyleProfiles();
  const domains = listApprovedPromptDomainTemplates();

  return styles.flatMap((style) => domains.map((domain) => ({
    cellId: buildCellId(style.id, domain.id),
    styleId: style.id,
    styleLabel: style.label,
    domainId: domain.id,
    domainLabel: domain.label,
    starter: STARTER_COMBINATIONS.has(`${style.id}::${domain.id}`),
    manualSelectionAllowed: true as const,
  }))).slice(0, STYLE_STRESS_MAX_CELLS);
}

export function listStarterStyleStressMatrixCells(): StyleStressMatrixCell[] {
  return listStyleStressMatrixCells().filter((entry) => entry.starter);
}

export function getStyleStressMatrixCellById(cellId: string): StyleStressMatrixCell | null {
  const normalized = cellId.trim().toUpperCase();
  return listStyleStressMatrixCells().find((entry) => entry.cellId === normalized) ?? null;
}

export function getStyleStressCellResources(cellId: string) {
  const cell = getStyleStressMatrixCellById(cellId);
  if (!cell) {
    return null;
  }

  const styleProfile = getApprovedVisualStyleProfileById(cell.styleId);
  const domain = getApprovedPromptDomainTemplateById(cell.domainId);
  if (!styleProfile || !domain) {
    return null;
  }

  return {
    cell,
    styleProfile,
    domain,
  };
}