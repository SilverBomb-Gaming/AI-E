import type { JointState } from "./articulatedEntityState";

export const GOVERNED_ARTICULATED_MAX_JOINTS = 8;
export const GOVERNED_ARTICULATED_MAX_CHAIN_DEPTH = 3;

export const SEGMENTED_DRONE_JOINT_IDS = [
  "drone_root",
  "left_arm_base",
  "left_arm_tip",
  "right_arm_base",
  "right_arm_tip",
  "beacon_mount",
] as const;

export type SegmentedDroneJointId = (typeof SEGMENTED_DRONE_JOINT_IDS)[number];

type JointDefinition = {
  id: SegmentedDroneJointId;
  parentId: SegmentedDroneJointId | null;
  length: number;
};

const SEGMENTED_DRONE_HIERARCHY: JointDefinition[] = [
  { id: "drone_root", parentId: null, length: 0 },
  { id: "left_arm_base", parentId: "drone_root", length: 22 },
  { id: "left_arm_tip", parentId: "left_arm_base", length: 16 },
  { id: "right_arm_base", parentId: "drone_root", length: 22 },
  { id: "right_arm_tip", parentId: "right_arm_base", length: 16 },
  { id: "beacon_mount", parentId: "drone_root", length: 14 },
];

export function createSegmentedDroneJointState(): JointState[] {
  return SEGMENTED_DRONE_HIERARCHY.map((joint) => ({
    id: joint.id,
    parentId: joint.parentId,
    localAngle: 0,
    previousAngle: 0,
    angularVelocity: 0,
    length: joint.length,
    continuityScore: 100,
  }));
}

export function resolveJointHierarchy(joints: JointState[]): JointState[] {
  const jointMap = new Map(joints.map((joint) => [joint.id, joint]));
  const ordered: JointState[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string, depth: number): void {
    if (visited.has(id) || ordered.length >= GOVERNED_ARTICULATED_MAX_JOINTS) {
      return;
    }
    if (visiting.has(id) || depth > GOVERNED_ARTICULATED_MAX_CHAIN_DEPTH) {
      return;
    }
    const joint = jointMap.get(id);
    if (!joint) {
      return;
    }
    visiting.add(id);
    if (joint.parentId) {
      visit(joint.parentId, depth + 1);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(joint);
  }

  for (const id of SEGMENTED_DRONE_JOINT_IDS) {
    visit(id, 0);
  }

  return ordered;
}

export function measureJointDepth(joints: JointState[]): number {
  const jointMap = new Map(joints.map((joint) => [joint.id, joint]));
  function depthOf(id: string | null): number {
    if (!id) {
      return 0;
    }
    const joint = jointMap.get(id);
    if (!joint || !joint.parentId) {
      return joint ? 1 : 0;
    }
    return Math.min(GOVERNED_ARTICULATED_MAX_CHAIN_DEPTH, 1 + depthOf(joint.parentId));
  }
  return joints.reduce((maxDepth, joint) => Math.max(maxDepth, depthOf(joint.id)), 0);
}