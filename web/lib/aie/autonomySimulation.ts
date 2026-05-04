import {
  FIRST_AUTONOMY_LANE,
  type AutonomyPolicy,
  validateAutonomyPolicy,
} from "./autonomyPolicy";
import type { LearningApplicationQueueRecord } from "./learningApplicationQueue";
import { suggestQueueExecutionOrder } from "./learningQueueOrdering";

export type AutonomySimulationBlockedItem = {
  queue_id: string;
  reason: string;
};

export type AutonomySimulationResult = {
  simulated: true;
  execution_plan: string[];
  executable_items: string[];
  blocked_items: AutonomySimulationBlockedItem[];
  reasons: string[];
  execution_triggered: false;
  autonomy_triggered: false;
};

function pushReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

export function simulateAutonomousRun(
  queueItems: readonly LearningApplicationQueueRecord[],
  policy: AutonomyPolicy,
): AutonomySimulationResult {
  const validation = validateAutonomyPolicy(policy);
  const reasons: string[] = [];
  const blockedItems: AutonomySimulationBlockedItem[] = [];
  const executionPlan: string[] = [];
  const executableItems: string[] = [];
  const queuedItems = queueItems.filter((item) => item.status === "queued");

  for (const item of queueItems) {
    if (item.status !== "queued") {
      blockedItems.push({
        queue_id: item.queue_id,
        reason: item.blocked_reason ?? `queue item is ${item.status}`,
      });
    }
  }

  if (!validation.valid) {
    for (const error of validation.errors) {
      pushReason(reasons, error);
    }

    for (const item of queuedItems) {
      blockedItems.push({
        queue_id: item.queue_id,
        reason: "autonomy policy validation failed",
      });
    }

    return {
      simulated: true,
      execution_plan: executionPlan,
      executable_items: executableItems,
      blocked_items: blockedItems,
      reasons,
      execution_triggered: false,
      autonomy_triggered: false,
    };
  }

  if (!policy.autonomy_enabled) {
    pushReason(reasons, policy.blocked_reason);

    for (const item of queuedItems) {
      blockedItems.push({
        queue_id: item.queue_id,
        reason: policy.blocked_reason,
      });
    }

    return {
      simulated: true,
      execution_plan: executionPlan,
      executable_items: executableItems,
      blocked_items: blockedItems,
      reasons,
      execution_triggered: false,
      autonomy_triggered: false,
    };
  }

  if (policy.allowed_lane !== FIRST_AUTONOMY_LANE.lane) {
    const reason = "autonomy lane not supported for simulation";
    pushReason(reasons, reason);

    for (const item of queuedItems) {
      blockedItems.push({
        queue_id: item.queue_id,
        reason,
      });
    }

    return {
      simulated: true,
      execution_plan: executionPlan,
      executable_items: executableItems,
      blocked_items: blockedItems,
      reasons,
      execution_triggered: false,
      autonomy_triggered: false,
    };
  }

  const suggestedOrder = suggestQueueExecutionOrder(queueItems).suggested_order;
  const limitedOrder = suggestedOrder.slice(0, policy.max_items_per_run);

  executionPlan.push(...limitedOrder);
  executableItems.push(...limitedOrder);

  if (limitedOrder.length > 0) {
    pushReason(reasons, "simulation only: Layer 29 safety stack would still be required before any real execution");
    pushReason(reasons, "cooldown assumed: only one execution can be considered per simulated run");
    pushReason(reasons, "conflict assumed: only one execution can be considered at a time");
  }

  if (suggestedOrder.length > policy.max_items_per_run) {
    pushReason(reasons, `max_items_per_run limit applied at ${policy.max_items_per_run}`);
  }

  for (const queueId of suggestedOrder.slice(policy.max_items_per_run)) {
    blockedItems.push({
      queue_id: queueId,
      reason: `max_items_per_run limit reached (${policy.max_items_per_run})`,
    });
  }

  return {
    simulated: true,
    execution_plan: executionPlan,
    executable_items: executableItems,
    blocked_items: blockedItems,
    reasons,
    execution_triggered: false,
    autonomy_triggered: false,
  };
}