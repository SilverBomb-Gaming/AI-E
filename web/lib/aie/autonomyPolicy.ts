export type AutonomyLane = "none" | "single_queued_learning_item";

export type AutonomyPolicy = {
  autonomy_enabled: boolean;
  allowed_lane: AutonomyLane;
  max_items_per_run: number;
  requires_operator_review: true;
  allowed_actions: string[];
  blocked_reason: "autonomy disabled";
};

export type AutonomyLaneDefinition = {
  lane: Exclude<AutonomyLane, "none">;
  description: string;
  max_items_per_run: 1;
  reuses_safety_stack: [
    "proposal",
    "snapshot recheck",
    "cooldown guard",
    "conflict lock",
    "existing gate",
    "drift protection",
    "single-item execution only",
  ];
  enabled_by_default: false;
};

export type AutonomyPolicyValidation = {
  valid: boolean;
  errors: string[];
};

export const FIRST_AUTONOMY_LANE: AutonomyLaneDefinition = {
  lane: "single_queued_learning_item",
  description: "One queued learning item, still guarded by the full Layer 29 operator-confirmed safety stack.",
  max_items_per_run: 1,
  reuses_safety_stack: [
    "proposal",
    "snapshot recheck",
    "cooldown guard",
    "conflict lock",
    "existing gate",
    "drift protection",
    "single-item execution only",
  ],
  enabled_by_default: false,
};

export function getAutonomyPolicy(): AutonomyPolicy {
  return {
    autonomy_enabled: false,
    allowed_lane: "none",
    max_items_per_run: 0,
    requires_operator_review: true,
    allowed_actions: [],
    blocked_reason: "autonomy disabled",
  };
}

export function validateAutonomyPolicy(policy: AutonomyPolicy): AutonomyPolicyValidation {
  const errors: string[] = [];

  if (policy.requires_operator_review !== true) {
    errors.push("autonomy policy cannot bypass operator review");
  }

  if (policy.allowed_lane === "none") {
    if (policy.max_items_per_run !== 0) {
      errors.push("lane none must keep max_items_per_run at 0");
    }
  }

  if (policy.allowed_lane === FIRST_AUTONOMY_LANE.lane) {
    if (policy.max_items_per_run !== FIRST_AUTONOMY_LANE.max_items_per_run) {
      errors.push("single_queued_learning_item must keep max_items_per_run at 1");
    }
  }

  if (policy.autonomy_enabled && policy.allowed_lane === "none") {
    errors.push("enabled autonomy policy requires a defined lane");
  }

  if (!policy.autonomy_enabled) {
    if (policy.blocked_reason !== "autonomy disabled") {
      errors.push("disabled autonomy policy must report autonomy disabled");
    }

    if (policy.allowed_lane !== "none") {
      errors.push("autonomy must remain on lane none while disabled by default");
    }

    if (policy.allowed_actions.length !== 0) {
      errors.push("disabled autonomy policy cannot allow actions");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function renderAutonomyPolicy(policy: AutonomyPolicy): string {
  const allowedActions = policy.allowed_actions.length > 0 ? policy.allowed_actions.join(", ") : "none";

  return [
    "CONTROLLED AUTONOMY POLICY",
    `Autonomy enabled: ${policy.autonomy_enabled ? "true" : "false"}`,
    `Allowed lane: ${policy.allowed_lane}`,
    `Max items per run: ${policy.max_items_per_run}`,
    `Requires operator review: ${policy.requires_operator_review ? "true" : "false"}`,
    `Allowed actions: ${allowedActions}`,
    `Blocked reason: ${policy.blocked_reason}`,
    `Defined future lane: ${FIRST_AUTONOMY_LANE.lane}`,
    `Future lane default enabled: ${FIRST_AUTONOMY_LANE.enabled_by_default ? "true" : "false"}`,
    `Future lane safety stack: ${FIRST_AUTONOMY_LANE.reuses_safety_stack.join(", ")}`,
  ].join("\n");
}