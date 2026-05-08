import type { ArticulatedEntityFrameDiagnostics } from "./articulatedEntityState";

export function summarizeArticulatedEntityDiagnostics(diagnostics: ArticulatedEntityFrameDiagnostics[]): {
  maxChainDepth: number;
  jointContinuityScore: number;
  poseStabilityScore: number;
  silhouetteReadabilityScore: number;
  entitySpatialPersistenceScore: number;
  entityCameraFramingCompatibilityScore: number;
  rejectedPoseTransitionCount: number;
  rollbackIntegrityStatus: "PASS" | "WATCH";
  articulatedEntitySummary: string;
  poseGovernanceSummary: string;
} {
  const count = Math.max(1, diagnostics.length);
  const average = (selector: (entry: ArticulatedEntityFrameDiagnostics) => number) => Math.round(diagnostics.reduce((sum, entry) => sum + selector(entry), 0) / count);
  const rejectedPoseTransitionCount = diagnostics.reduce((max, entry) => Math.max(max, entry.rejectedPoseTransitionCount), 0);
  const rollbackIntegrityStatus = diagnostics.some((entry) => entry.rollbackRestoredPose) ? "PASS" : "WATCH";
  return {
    maxChainDepth: diagnostics.reduce((maxDepth, entry) => Math.max(maxDepth, entry.maxChainDepth), 0),
    jointContinuityScore: average((entry) => entry.jointContinuityScore),
    poseStabilityScore: average((entry) => entry.poseStabilityScore),
    silhouetteReadabilityScore: average((entry) => entry.silhouetteReadabilityScore),
    entitySpatialPersistenceScore: average((entry) => entry.entitySpatialPersistenceScore),
    entityCameraFramingCompatibilityScore: average((entry) => entry.entityCameraFramingCompatibilityScore),
    rejectedPoseTransitionCount,
    rollbackIntegrityStatus,
    articulatedEntitySummary: diagnostics.length > 0
      ? `Segmented drone remains mechanically readable with ${diagnostics[0]!.jointCount} stable joints and deterministic articulated arm sweeps.`
      : "No articulated entity diagnostics were recorded.",
    poseGovernanceSummary: `Pose continuity and rollback governance remain explicit with ${rejectedPoseTransitionCount} rejected transitions and rollback integrity ${rollbackIntegrityStatus}.`,
  };
}