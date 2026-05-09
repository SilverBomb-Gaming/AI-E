import type { FormationType, MultiEntityCameraHint } from "./multiEntityState";

const GOVERNED_MULTI_ENTITY_IDS = [
  "governed-segmented-drone-001",
  "governed-segmented-drone-002",
  "governed-segmented-drone-003",
] as const;

export type GovernedFormationEntityPlan = {
  id: string;
  rootTargetX: number;
  rootTargetY: number;
  jointPhaseOffset: number;
  orientationBias: number;
  variantIndex: number;
};

export type GovernedFormationPlan = {
  formationType: FormationType;
  choreographyPhase: number;
  entityPlans: GovernedFormationEntityPlan[];
  cameraHint: MultiEntityCameraHint;
};

export type GovernedFormationControllerInput = {
  frameIndex: number;
  totalFrames: number;
  mode: "micro-sequence" | "motion-preview";
  width: number;
  height: number;
  formationEmphasis?: number;
  beaconClearancePreference?: number;
  groupReadabilityPreference?: number;
  compositionBalancePreference?: number;
  reactionEnergyPreference?: number;
  formationCompressionPreference?: number;
  movementCarryoverPreference?: number;
  formationExpansionPreference?: number;
  transitionSoftnessPreference?: number;
  settleStabilizationPreference?: number;
  formationIdentityPreference?: number;
  environmentIdentityIntensity?: number;
  residueContinuityPreference?: number;
  chamberCenterX: number;
  horizonY: number;
  platformY: number;
  cubeAnchorX: number;
  cubeAnchorY: number;
  beaconX: number;
  beaconY: number;
};

function selectFormationType(input: GovernedFormationControllerInput): FormationType {
  const microPlan: FormationType[] = ["DUAL_ORBIT", "MIRRORED_SENTRIES", "STAGGERED_PASS"];
  const motionPlan: FormationType[] = ["MIRRORED_SENTRIES", "DUAL_ORBIT", "STAGGERED_PASS", "BEACON_TRIANGULATION"];
  const plan = input.mode === "motion-preview" ? motionPlan : microPlan;
  return plan[Math.min(plan.length - 1, input.frameIndex)]!;
}

function buildCameraHint(positions: Array<{ x: number; y: number }>): MultiEntityCameraHint {
  const groupCenterX = positions.reduce((sum, position) => sum + position.x, 0) / positions.length;
  const groupCenterY = positions.reduce((sum, position) => sum + position.y, 0) / positions.length;
  const groupRadius = Math.max(...positions.map((position) => Math.hypot(position.x - groupCenterX, position.y - groupCenterY)), 24);
  return { groupCenterX, groupCenterY, groupRadius };
}

function buildPlanFromPositions(
  formationType: FormationType,
  positions: Array<{ x: number; y: number }>,
  jointPhaseOffsets: number[],
  orientationBiases: number[],
  choreographyPhase: number,
): GovernedFormationPlan {
  return {
    formationType,
    choreographyPhase,
    entityPlans: positions.map((position, index) => ({
      id: GOVERNED_MULTI_ENTITY_IDS[index]!,
      rootTargetX: position.x,
      rootTargetY: position.y,
      jointPhaseOffset: jointPhaseOffsets[index] ?? 0,
      orientationBias: orientationBiases[index] ?? 0,
      variantIndex: index,
    })),
    cameraHint: buildCameraHint(positions),
  };
}

export function buildGovernedFormationPlan(input: GovernedFormationControllerInput): GovernedFormationPlan {
  const formationType = selectFormationType(input);
  const cubeBeaconCenterX = (input.cubeAnchorX + input.beaconX) / 2;
  const cubeBeaconCenterY = (input.cubeAnchorY + input.beaconY) / 2;
  const choreographyPhase = input.frameIndex * 0.42;
  const emphasis = input.formationEmphasis ?? 0;
  const beaconClearancePreference = input.beaconClearancePreference ?? 0;
  const groupReadabilityPreference = input.groupReadabilityPreference ?? 0;
  const compositionBalancePreference = input.compositionBalancePreference ?? 0;
  const reactionEnergyPreference = input.reactionEnergyPreference ?? 0;
  const formationCompressionPreference = input.formationCompressionPreference ?? 0;
  const movementCarryoverPreference = input.movementCarryoverPreference ?? 0;
  const formationExpansionPreference = input.formationExpansionPreference ?? 0;
  const transitionSoftnessPreference = input.transitionSoftnessPreference ?? 0;
  const settleStabilizationPreference = input.settleStabilizationPreference ?? 0;
  const formationIdentityPreference = input.formationIdentityPreference ?? 0;
  const environmentIdentityIntensity = input.environmentIdentityIntensity ?? 0;
  const residueContinuityPreference = input.residueContinuityPreference ?? 0;
  const orbitRadiusX = input.width * (0.17 + emphasis * 0.08 + reactionEnergyPreference * 0.015 + formationExpansionPreference * 0.014 + transitionSoftnessPreference * 0.008 + formationIdentityPreference * 0.008 - formationCompressionPreference * 0.01 - settleStabilizationPreference * 0.006 - residueContinuityPreference * 0.004);
  const orbitRadiusY = input.height * 0.06;

  if (formationType === "DUAL_ORBIT") {
    const left = {
      x: cubeBeaconCenterX - orbitRadiusX + Math.sin(choreographyPhase) * 5,
      y: cubeBeaconCenterY - input.height * 0.02 + Math.cos(choreographyPhase) * orbitRadiusY * (0.4 + formationIdentityPreference * 0.03),
    };
    const right = {
      x: cubeBeaconCenterX + orbitRadiusX - Math.sin(choreographyPhase) * 5,
      y: cubeBeaconCenterY - input.height * 0.02 - Math.cos(choreographyPhase) * orbitRadiusY * (0.4 + formationIdentityPreference * 0.03),
    };
    return buildPlanFromPositions(formationType, [left, right], [0, Math.PI], [-3, 3], choreographyPhase);
  }

  if (formationType === "MIRRORED_SENTRIES") {
    return buildPlanFromPositions(
      formationType,
      [
        { x: input.chamberCenterX - input.width * (0.2 + emphasis * 0.07 + formationIdentityPreference * 0.02), y: input.horizonY - (34 + environmentIdentityIntensity * 1.4) },
        { x: input.chamberCenterX + input.width * (0.2 + emphasis * 0.07 + formationIdentityPreference * 0.02), y: input.horizonY - (34 + environmentIdentityIntensity * 1.4) },
      ],
      [0, Math.PI],
      [-4, 4],
      choreographyPhase,
    );
  }

  if (formationType === "STAGGERED_PASS") {
    const foregroundRight = {
      x: input.chamberCenterX + input.width * (0.24 + emphasis * 0.05 + groupReadabilityPreference * 0.03 + formationExpansionPreference * 0.02),
      y: input.horizonY - (26 + reactionEnergyPreference * 2 + movementCarryoverPreference * 1.5 - transitionSoftnessPreference * 0.8 + settleStabilizationPreference * 0.4 + environmentIdentityIntensity * 0.8),
    };
    const backgroundLeft = {
      x: input.frameIndex === 2 && input.mode === "motion-preview"
        ? input.chamberCenterX + input.width * (0.14 + beaconClearancePreference * 0.04)
        : input.chamberCenterX - input.width * (0.23 + emphasis * 0.04 + beaconClearancePreference * 0.04),
      y: input.horizonY - (50 + groupReadabilityPreference * 5 + movementCarryoverPreference * 1.2 - formationCompressionPreference * 4 + transitionSoftnessPreference * 0.7 + settleStabilizationPreference * 0.5 + residueContinuityPreference * 1.2),
    };
    return buildPlanFromPositions(formationType, [foregroundRight, backgroundLeft], [0, Math.PI], [5, -7], choreographyPhase);
  }

  return buildPlanFromPositions(
    "BEACON_TRIANGULATION",
    [
      {
        x: input.beaconX - input.width * (0.18 + emphasis * 0.04 + beaconClearancePreference * 0.06 + formationIdentityPreference * 0.02),
        y: input.horizonY - (46 + groupReadabilityPreference * 3 + movementCarryoverPreference * 1.2 + transitionSoftnessPreference * 0.6 + environmentIdentityIntensity * 0.8),
      },
      {
        x: input.beaconX + input.width * (0.18 + emphasis * 0.04 + beaconClearancePreference * 0.06 + formationIdentityPreference * 0.02),
        y: input.horizonY - (46 + groupReadabilityPreference * 3 + movementCarryoverPreference * 1.2 + transitionSoftnessPreference * 0.6 + environmentIdentityIntensity * 0.8),
      },
      {
        x: input.chamberCenterX,
        y: input.horizonY + 6 + emphasis * 6 - compositionBalancePreference * 4 - reactionEnergyPreference * 3 - movementCarryoverPreference * 2 + settleStabilizationPreference * 1.2 + residueContinuityPreference * 1.1,
      },
    ],
    [0, Math.PI, Math.PI / 2],
    [-4, 4, 0],
    choreographyPhase,
  );
}
