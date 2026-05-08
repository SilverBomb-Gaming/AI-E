import type { MultiEntitySceneFrameDiagnostics } from "./multiEntityState";

function average(values: number[]): number {
  return values.length > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

export function summarizeMultiEntityDiagnostics(diagnostics: MultiEntitySceneFrameDiagnostics[]): {
  activeFormationType?: MultiEntitySceneFrameDiagnostics["activeFormationType"];
  entityCount: number;
  entitySeparationScore: number;
  formationStabilityScore: number;
  multiEntitySilhouetteScore: number;
  choreographyContinuityScore: number;
  groupSpatialPersistenceScore: number;
  interactionPersistenceScore: number;
  rollbackRestoredFormation: boolean;
  rejectedFormationTransitionCount: number;
  multiEntityChoreographySummary: string;
  spacingGovernanceSummary: string;
  rollbackIntegrityStatus: "PASS" | "WATCH";
} {
  const last = diagnostics[diagnostics.length - 1];
  const entityCount = last?.entityCount ?? 0;
  const entitySeparationScore = average(diagnostics.map((entry) => entry.entitySeparationScore));
  const formationStabilityScore = average(diagnostics.map((entry) => entry.formationStabilityScore));
  const multiEntitySilhouetteScore = average(diagnostics.map((entry) => entry.multiEntitySilhouetteScore));
  const choreographyContinuityScore = average(diagnostics.map((entry) => entry.choreographyContinuityScore));
  const groupSpatialPersistenceScore = average(diagnostics.map((entry) => entry.groupSpatialPersistenceScore));
  const interactionPersistenceScore = average(diagnostics.map((entry) => entry.interactionPersistenceScore));
  const rejectedFormationTransitionCount = Math.max(...diagnostics.map((entry) => entry.rejectedFormationTransitionCount), 0);
  const rollbackRestoredFormation = diagnostics.some((entry) => entry.rollbackRestoredFormation);
  const rollbackIntegrityStatus = entitySeparationScore >= 95 && formationStabilityScore >= 95 && groupSpatialPersistenceScore >= 95 ? "PASS" : "WATCH";

  return {
    activeFormationType: last?.activeFormationType,
    entityCount,
    entitySeparationScore,
    formationStabilityScore,
    multiEntitySilhouetteScore,
    choreographyContinuityScore,
    groupSpatialPersistenceScore,
    interactionPersistenceScore,
    rollbackRestoredFormation,
    rejectedFormationTransitionCount,
    multiEntityChoreographySummary: `${last?.activeFormationType ?? "DUAL_ORBIT"} keeps ${entityCount} governed segmented drones staged as one deterministic mechanical group around the cube and beacon anchor.`,
    spacingGovernanceSummary: `Spacing governance held ${entitySeparationScore}/100 separation, ${formationStabilityScore}/100 formation stability, and ${groupSpatialPersistenceScore}/100 group persistence with rollback ${rollbackRestoredFormation ? "engaged" : "available"}.`,
    rollbackIntegrityStatus,
  };
}
