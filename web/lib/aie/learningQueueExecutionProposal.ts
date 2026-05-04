import { executeQueuedLearningItem, type LearningApplicationQueueExecutionResult, type LearningApplicationQueueRecord } from "./learningApplicationQueue";
import { suggestQueueExecutionOrder } from "./learningQueueOrdering";

export type LearningQueueExecutionProposal = {
  next_queue_id?: string;
  reasoning: string;
  requires_confirmation: true;
  execution_triggered: false;
  autonomy_triggered: false;
};

let pendingProposedQueueId: string | null = null;

export function proposeNextQueueExecution(
  queueItems: readonly LearningApplicationQueueRecord[],
): LearningQueueExecutionProposal {
  const suggestion = suggestQueueExecutionOrder(queueItems);
  const nextQueueId = suggestion.suggested_order[0];

  pendingProposedQueueId = nextQueueId ?? null;

  return {
    next_queue_id: nextQueueId,
    reasoning: nextQueueId
      ? `${suggestion.reasoning} Explicit operator confirmation is required before executing the proposed queue item.`
      : `${suggestion.reasoning} No queue item is currently eligible for confirmation.`,
    requires_confirmation: true,
    execution_triggered: false,
    autonomy_triggered: false,
  };
}

export async function confirmAndExecute(
  queueId: string,
  options?: Parameters<typeof executeQueuedLearningItem>[1],
): Promise<LearningApplicationQueueExecutionResult> {
  if (!pendingProposedQueueId) {
    return {
      queue_execution_id: "learning-queue-execution-unconfirmed",
      created_at: options?.executedAt ?? new Date().toISOString(),
      queue_id: queueId,
      recommendation_id: "unknown-recommendation",
      decision_id: "unknown-decision",
      status: "blocked",
      reason: "operator confirmation required",
      applied: false,
      single_item_execution: true,
    };
  }

  if (pendingProposedQueueId !== queueId) {
    return {
      queue_execution_id: "learning-queue-execution-mismatch",
      created_at: options?.executedAt ?? new Date().toISOString(),
      queue_id: queueId,
      recommendation_id: "unknown-recommendation",
      decision_id: "unknown-decision",
      status: "blocked",
      reason: "proposed queue item mismatch",
      applied: false,
      single_item_execution: true,
    };
  }

  pendingProposedQueueId = null;
  return executeQueuedLearningItem(queueId, options);
}

export function resetLearningQueueExecutionProposal(): void {
  pendingProposedQueueId = null;
}