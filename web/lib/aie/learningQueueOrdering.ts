import type { LearningApplicationQueueRecord } from "./learningApplicationQueue";

export type LearningQueueOrderingSuggestion = {
  suggested_order: string[];
  reasoning: string;
  based_on: ["risk", "confidence", "drift"];
  execution_triggered: false;
  autonomy_triggered: false;
};

type RankedQueueItem = {
  queue_id: string;
  created_at: string;
  adjustment_magnitude: number;
  confidence: number;
  risk_score: number;
};

function buildRankedQueueItem(item: LearningApplicationQueueRecord): RankedQueueItem {
  const adjustmentMagnitude = Math.abs(item.recommendation_snapshot.confidence);
  const confidence = item.recommendation_snapshot.confidence;
  const riskScore = Math.round((adjustmentMagnitude + (1 - confidence)) * 1000) / 1000;

  return {
    queue_id: item.queue_id,
    created_at: item.created_at,
    adjustment_magnitude: adjustmentMagnitude,
    confidence,
    risk_score: riskScore,
  };
}

function compareRankedItems(left: RankedQueueItem, right: RankedQueueItem): number {
  if (left.risk_score !== right.risk_score) {
    return left.risk_score - right.risk_score;
  }

  if (left.adjustment_magnitude !== right.adjustment_magnitude) {
    return left.adjustment_magnitude - right.adjustment_magnitude;
  }

  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }

  return left.created_at.localeCompare(right.created_at);
}

export function suggestQueueExecutionOrder(
  queueItems: readonly LearningApplicationQueueRecord[],
): LearningQueueOrderingSuggestion {
  const queuedItems = queueItems
    .filter((item) => item.status === "queued")
    .map((item) => buildRankedQueueItem(item))
    .sort(compareRankedItems);

  const suggestedOrder = queuedItems.map((item) => item.queue_id);
  const reasoning = queuedItems.length === 0
    ? "No queued learning items were eligible for suggestion. Suggestion only. No execution or reordering occurred."
    : "Suggested order favors lower-risk, smaller adjustment items first, while using higher confidence to break close ties and reduce projected drift exposure. Suggestion only. No execution or reordering occurred.";

  return {
    suggested_order: suggestedOrder,
    reasoning,
    based_on: ["risk", "confidence", "drift"],
    execution_triggered: false,
    autonomy_triggered: false,
  };
}