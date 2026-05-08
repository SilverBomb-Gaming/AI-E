import { clamp } from "../camera/cameraConstraints";
import type { ArticulatedEntitySnapshot } from "./articulatedEntityState";
import { computeGovernedArticulatedEntityFrame, type GovernedArticulatedEntityInput } from "./poseSolver";
import { buildGovernedFormationPlan, type GovernedFormationControllerInput } from "./entityFormationController";
import type {
  MultiEntityCameraHint,
  MultiEntitySceneFrameDiagnostics,
  MultiEntitySceneSnapshot,
  MultiEntitySceneState,
} from "./multiEntityState";

const GOVERNED_MIN_ENTITY_SEPARATION = 95;
const GOVERNED_MIN_FORMATION_STABILITY = 95;
const GOVERNED_MIN_MULTI_SILHOUETTE = 90;
const GOVERNED_MIN_GROUP_PERSISTENCE = 95;

export type GovernedMultiEntitySceneInput = GovernedFormationControllerInput & {
  cameraCenterX: number;
  cameraCenterY: number;
  previousSnapshot?: MultiEntitySceneSnapshot | null;
};

export type GovernedMultiEntitySceneResult = {
  state: MultiEntitySceneState;
  entitySnapshots: ArticulatedEntitySnapshot[];
  diagnostics: MultiEntitySceneFrameDiagnostics;
  snapshot: MultiEntitySceneSnapshot;
  cameraHint: MultiEntityCameraHint;
};

function buildCameraHint(entitySnapshots: ArticulatedEntitySnapshot[]): MultiEntityCameraHint {
  const groupCenterX = entitySnapshots.reduce((sum, entry) => sum + entry.state.rootPosition.x, 0) / entitySnapshots.length;
  const groupCenterY = entitySnapshots.reduce((sum, entry) => sum + entry.state.rootPosition.y, 0) / entitySnapshots.length;
  const groupRadius = Math.max(
    ...entitySnapshots.map((entry) => Math.hypot(entry.state.rootPosition.x - groupCenterX, entry.state.rootPosition.y - groupCenterY)),
    24,
  );
  return { groupCenterX, groupCenterY, groupRadius };
}

function evaluateMultiEntityDiagnostics(
  input: GovernedMultiEntitySceneInput,
  entitySnapshots: ArticulatedEntitySnapshot[],
  expectedFormation: ReturnType<typeof buildGovernedFormationPlan>,
  previousSnapshot: MultiEntitySceneSnapshot | null,
): MultiEntitySceneFrameDiagnostics {
  const pairDistances: number[] = [];
  for (let leftIndex = 0; leftIndex < entitySnapshots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entitySnapshots.length; rightIndex += 1) {
      const left = entitySnapshots[leftIndex]!.state.rootPosition;
      const right = entitySnapshots[rightIndex]!.state.rootPosition;
      pairDistances.push(Math.hypot(left.x - right.x, left.y - right.y));
    }
  }
  const minPairDistance = pairDistances.length > 0 ? Math.min(...pairDistances) : 64;
  const averageFormationOffset = entitySnapshots.reduce((sum, entry, index) => {
    const expected = expectedFormation.entityPlans[index]!;
    return sum + Math.hypot(entry.state.rootPosition.x - expected.rootTargetX, entry.state.rootPosition.y - expected.rootTargetY);
  }, 0) / entitySnapshots.length;
  const cameraHint = buildCameraHint(entitySnapshots);
  const previousGroupCenter = previousSnapshot?.state.groupCenter ?? { x: cameraHint.groupCenterX, y: cameraHint.groupCenterY, z: 0 };
  const groupStep = Math.hypot(cameraHint.groupCenterX - previousGroupCenter.x, cameraHint.groupCenterY - previousGroupCenter.y);
  const minEdgeInset = Math.min(
    ...entitySnapshots.flatMap((entry) => [
      entry.state.rootPosition.x,
      input.width - entry.state.rootPosition.x,
      entry.state.rootPosition.y,
      input.height - entry.state.rootPosition.y,
    ]),
  );
  const averagePoseContinuity = entitySnapshots.reduce((sum, entry) => sum + entry.diagnostics.jointContinuityScore, 0) / entitySnapshots.length;
  const averageEntityPersistence = entitySnapshots.reduce((sum, entry) => sum + entry.diagnostics.entitySpatialPersistenceScore, 0) / entitySnapshots.length;
  const averageSilhouetteReadability = entitySnapshots.reduce((sum, entry) => sum + entry.diagnostics.silhouetteReadabilityScore, 0) / entitySnapshots.length;

  const entitySeparationScore = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, 60 - minPairDistance) * 2.5)));
  const formationStabilityScore = Math.max(0, Math.min(100, Math.round(100 - averageFormationOffset * 3.2)));
  const edgeInsetScore = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, 12 - minEdgeInset) * 1.4)));
  const multiEntitySilhouetteScore = Math.max(0, Math.min(100, Math.round(
    averageSilhouetteReadability * 0.45 + entitySeparationScore * 0.35 + edgeInsetScore * 0.2,
  )));
  const choreographyContinuityScore = Math.max(0, Math.min(100, Math.round((averagePoseContinuity + formationStabilityScore + Math.max(0, 100 - groupStep * 3.5)) / 3)));
  const groupSpatialPersistenceScore = Math.max(0, Math.min(100, Math.round((averageEntityPersistence + Math.max(0, 100 - groupStep * 3.2) + formationStabilityScore) / 3)));
  const interactionPersistenceScore = Math.max(0, Math.min(100, Math.round((entitySeparationScore + choreographyContinuityScore + groupSpatialPersistenceScore) / 3)));

  return {
    activeFormationType: expectedFormation.formationType,
    entityCount: entitySnapshots.length,
    entityIds: entitySnapshots.map((entry) => entry.state.id),
    rollbackRestoredPose: entitySnapshots.some((entry) => entry.diagnostics.rollbackRestoredPose),
    rejectedPoseTransitionCount: entitySnapshots.reduce((max, entry) => Math.max(max, entry.diagnostics.rejectedPoseTransitionCount), 0),
    entitySeparationScore,
    formationStabilityScore,
    multiEntitySilhouetteScore,
    choreographyContinuityScore,
    groupSpatialPersistenceScore,
    interactionPersistenceScore,
    rollbackRestoredFormation: false,
    rejectedFormationTransitionCount: previousSnapshot?.state.rejectedFormationTransitionCount ?? 0,
    overlay: `${expectedFormation.formationType} • entities ${entitySnapshots.length} • separation ${entitySeparationScore}/100 • formation ${formationStabilityScore}/100 • rollback no`,
  };
}

export function computeGovernedMultiEntitySceneFrame(input: GovernedMultiEntitySceneInput): GovernedMultiEntitySceneResult {
  const previousSnapshot = input.previousSnapshot ?? null;
  const formationPlan = buildGovernedFormationPlan(input);
  const previousById = new Map((previousSnapshot?.entitySnapshots ?? []).map((entry) => [entry.state.id, entry]));
  const entitySnapshots = formationPlan.entityPlans.map((entityPlan, index) => {
    const entityInput: GovernedArticulatedEntityInput = {
      frameIndex: input.frameIndex,
      totalFrames: input.totalFrames,
      width: input.width,
      height: input.height,
      chamberCenterX: input.chamberCenterX,
      horizonY: input.horizonY,
      platformY: input.platformY,
      cubeAnchorX: input.cubeAnchorX,
      cubeAnchorY: input.cubeAnchorY,
      beaconX: input.beaconX,
      beaconY: input.beaconY,
      cameraCenterX: input.cameraCenterX,
      cameraCenterY: input.cameraCenterY,
      entityId: entityPlan.id,
      jointPhaseOffset: entityPlan.jointPhaseOffset,
      orientationBias: entityPlan.orientationBias,
      rootTargetX: entityPlan.rootTargetX,
      rootTargetY: entityPlan.rootTargetY,
      injectInvalidPoseTransition: input.frameIndex === 3 && index === 0,
      previousSnapshot: previousById.get(entityPlan.id) ?? null,
    };
    return computeGovernedArticulatedEntityFrame(entityInput).snapshot;
  });

  const diagnostics = evaluateMultiEntityDiagnostics(input, entitySnapshots, formationPlan, previousSnapshot);
  const cameraHint = buildCameraHint(entitySnapshots);
  const rejectedFormationTransitionCount = previousSnapshot?.state.rejectedFormationTransitionCount ?? 0;

  const shouldRollbackFormation = previousSnapshot !== null && (
    diagnostics.entitySeparationScore < GOVERNED_MIN_ENTITY_SEPARATION
    || diagnostics.formationStabilityScore < GOVERNED_MIN_FORMATION_STABILITY
    || diagnostics.multiEntitySilhouetteScore < GOVERNED_MIN_MULTI_SILHOUETTE
    || diagnostics.groupSpatialPersistenceScore < GOVERNED_MIN_GROUP_PERSISTENCE
  );

  if (shouldRollbackFormation) {
    const restoredState: MultiEntitySceneState = {
      ...previousSnapshot.state,
      rollbackRestoredFormation: true,
      rejectedFormationTransitionCount: rejectedFormationTransitionCount + 1,
    };
    const restoredDiagnostics: MultiEntitySceneFrameDiagnostics = {
      ...previousSnapshot.diagnostics,
      rollbackRestoredPose: diagnostics.rollbackRestoredPose,
      rejectedPoseTransitionCount: Math.max(previousSnapshot.diagnostics.rejectedPoseTransitionCount, diagnostics.rejectedPoseTransitionCount),
      rollbackRestoredFormation: true,
      rejectedFormationTransitionCount: restoredState.rejectedFormationTransitionCount,
      overlay: `${previousSnapshot.state.formationType} • entities ${previousSnapshot.state.entities.length} • separation ${previousSnapshot.diagnostics.entitySeparationScore}/100 • formation ${previousSnapshot.diagnostics.formationStabilityScore}/100 • rollback yes`,
    };
    const restoredSnapshot: MultiEntitySceneSnapshot = {
      frameIndex: input.frameIndex,
      state: restoredState,
      entitySnapshots: previousSnapshot.entitySnapshots,
      diagnostics: restoredDiagnostics,
      cameraHint: previousSnapshot.cameraHint,
    };
    return {
      state: restoredState,
      entitySnapshots: previousSnapshot.entitySnapshots,
      diagnostics: restoredDiagnostics,
      snapshot: restoredSnapshot,
      cameraHint: previousSnapshot.cameraHint,
    };
  }

  const state: MultiEntitySceneState = {
    entities: entitySnapshots.map((entry) => entry.state),
    formationType: formationPlan.formationType,
    choreographyPhase: clamp(formationPlan.choreographyPhase, -Math.PI, Math.PI),
    spacingScore: diagnostics.entitySeparationScore,
    interactionPersistenceScore: diagnostics.interactionPersistenceScore,
    rollbackRestoredFormation: false,
    rejectedFormationTransitionCount,
    entityIds: entitySnapshots.map((entry) => entry.state.id),
    groupCenter: { x: cameraHint.groupCenterX, y: cameraHint.groupCenterY, z: 0 },
    groupRadius: cameraHint.groupRadius,
  };
  const snapshot: MultiEntitySceneSnapshot = {
    frameIndex: input.frameIndex,
    state,
    entitySnapshots,
    diagnostics,
    cameraHint,
  };
  return {
    state,
    entitySnapshots,
    diagnostics,
    snapshot,
    cameraHint,
  };
}
