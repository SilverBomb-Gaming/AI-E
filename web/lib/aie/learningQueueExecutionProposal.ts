import { executeQueuedLearningItem, type LearningApplicationQueueExecutionResult, type LearningApplicationQueueRecord } from "./learningApplicationQueue";
import { suggestQueueExecutionOrder } from "./learningQueueOrdering";

export type LearningQueueExecutionProposal = {
  next_queue_id?: string;
  reasoning: string;
  requires_confirmation: true;
  execution_triggered: false;
  autonomy_triggered: false;
};

let pendingProposal:
  | {
    proposed_queue_id: string;
    proposal_snapshot_hash: string;
  }
  | null = null;

function buildProposalSnapshotHash(queueItem: LearningApplicationQueueRecord): string {
  return JSON.stringify({
    queue_id: queueItem.queue_id,
    status: queueItem.status,
    recommendation_snapshot: queueItem.recommendation_snapshot,
    decision_snapshot: queueItem.decision_snapshot,
  });
}

export function proposeNextQueueExecution(
  queueItems: readonly LearningApplicationQueueRecord[],
): LearningQueueExecutionProposal {
  const suggestion = suggestQueueExecutionOrder(queueItems);
  const nextQueueId = suggestion.suggested_order[0];
  const proposedItem = queueItems.find((item) => item.queue_id === nextQueueId);

  pendingProposal = nextQueueId && proposedItem
    ? {
      proposed_queue_id: nextQueueId,
      proposal_snapshot_hash: buildProposalSnapshotHash(proposedItem),
    }
    : null;

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
  if (!pendingProposal) {
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

  if (pendingProposal.proposed_queue_id !== queueId) {
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

  const { queryLearningApplicationQueue } = await import("./learningApplicationQueue");
  const currentQueueItems = await queryLearningApplicationQueue({ outputDirectory: options?.outputDirectory });
  const currentQueueItem = currentQueueItems.find((item) => item.queue_id === queueId);

  if (!currentQueueItem || buildProposalSnapshotHash(currentQueueItem) !== pendingProposal.proposal_snapshot_hash) {
    pendingProposal = null;
    return {
      queue_execution_id: "learning-queue-execution-state-changed",
      created_at: options?.executedAt ?? new Date().toISOString(),
      queue_id: queueId,
      recommendation_id: currentQueueItem?.recommendation_id ?? "unknown-recommendation",
      decision_id: currentQueueItem?.decision_id ?? "unknown-decision",
      status: "blocked",
      reason: "state changed since proposal",
      applied: false,
      single_item_execution: true,
    };
  }

  pendingProposal = null;
  return executeQueuedLearningItem(queueId, options);
}

export function resetLearningQueueExecutionProposal(): void {
  pendingProposal = null;
}