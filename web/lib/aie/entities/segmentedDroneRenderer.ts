import type { JointWorldTransform, SegmentedDroneRenderModel } from "./articulatedEntityState";

function buildBodyPolygon(centerX: number, centerY: number): Array<{ x: number; y: number }> {
  return [
    { x: centerX - 18, y: centerY - 10 },
    { x: centerX + 18, y: centerY - 10 },
    { x: centerX + 22, y: centerY + 8 },
    { x: centerX - 22, y: centerY + 8 },
  ];
}

export function buildSegmentedDroneRenderModel(input: {
  rootX: number;
  rootY: number;
  worldTransforms: JointWorldTransform[];
  beaconInfluenceStrength: number;
  variantIndex?: number;
}): SegmentedDroneRenderModel {
  const beaconMount = input.worldTransforms.find((joint) => joint.id === "beacon_mount");
  const variantIndex = input.variantIndex ?? 0;
  return {
    body: [
      {
        points: buildBodyPolygon(input.rootX, input.rootY),
        red: 92 - variantIndex * 8,
        green: 148 + variantIndex * 6,
        blue: 210 + variantIndex * 5,
        alpha: 0.92,
      },
      {
        points: [
          { x: input.rootX - 10, y: input.rootY - 5 },
          { x: input.rootX + 10, y: input.rootY - 5 },
          { x: input.rootX + 8, y: input.rootY + 4 },
          { x: input.rootX - 8, y: input.rootY + 4 },
        ],
        red: 176,
        green: 216 + variantIndex * 4,
        blue: 255,
        alpha: 0.36,
      },
    ],
    segments: input.worldTransforms
      .filter((joint) => joint.id !== "drone_root")
      .map((joint) => ({
        startX: joint.start.x,
        startY: joint.start.y,
        endX: joint.end.x,
        endY: joint.end.y,
        red: joint.id === "beacon_mount" ? 130 + variantIndex * 3 : 126 - variantIndex * 4,
        green: joint.id === "beacon_mount" ? 196 + variantIndex * 4 : 182 + variantIndex * 6,
        blue: 255,
        alpha: 0.86,
      })),
    joints: input.worldTransforms.map((joint) => ({
      centerX: joint.start.x,
      centerY: joint.start.y,
      radius: joint.id === "drone_root" ? 5 : 4,
      red: 188 - variantIndex * 3,
      green: 228,
      blue: 255,
      alpha: 0.78,
    })),
    beacon: beaconMount ? [
      {
        centerX: beaconMount.end.x,
        centerY: beaconMount.end.y,
        radius: 8,
        red: 74 + variantIndex * 4,
        green: 136 + variantIndex * 3,
        blue: 234,
        alpha: 0.24 + input.beaconInfluenceStrength * 0.08,
      },
      {
        centerX: beaconMount.end.x,
        centerY: beaconMount.end.y,
        radius: 4,
        red: 180,
        green: 226,
        blue: 255,
        alpha: 0.94,
      },
    ] : [],
  };
}