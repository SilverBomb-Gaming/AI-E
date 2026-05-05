import type { AutoRecordOutcomeResult } from "./autoOutcomeRecording";

export type PostPlaytestDecisionStatus =
  | "ready_for_next_feature"
  | "retry_recommended"
  | "escalation_recommended"
  | "blocked";

export type PostPlaytestDecisionResult = {
  status: PostPlaytestDecisionStatus;
  reason: string;
  recommended_next_action: string;
  confidence: "low" | "medium" | "high";
  source_outcome_session_key?: string;
  source_feature?: string;
};

const BLOCKED_ACTION = "Provide explicit feature context before recording or deciding.";
const PASS_ACTION = "Mark the feature stable and select the next validation target.";
const FAIL_ACTION = "Review failure evidence, apply the smallest safe fix, then rerun the reviewed Unity playtest.";
const ESCALATION_ACTION = "Ask the operator to inspect the playtest evidence before retrying.";

export function decidePostPlaytestNextAction(
  outcome: AutoRecordOutcomeResult | null,
): PostPlaytestDecisionResult {
  if (!outcome) {
    return {
      status: "escalation_recommended",
      reason: "No runtime-auto outcome was available after the reviewed Unity playtest, so AI-E cannot safely choose the next step.",
      recommended_next_action: ESCALATION_ACTION,
      confidence: "low",
    };
  }

  if (outcome.status === "blocked") {
    return {
      status: "blocked",
      reason: outcome.reason,
      recommended_next_action: BLOCKED_ACTION,
      confidence: "high",
    };
  }

  const baseResult = {
    source_feature: outcome.feature,
    source_outcome_session_key: outcome.recorded.record.sessionKey,
  };

  if (outcome.status === "duplicate") {
    return {
      ...baseResult,
      status: "escalation_recommended",
      reason: "No new runtime-auto outcome was written for this reviewed playtest because the session was already recorded.",
      recommended_next_action: ESCALATION_ACTION,
      confidence: "medium",
    };
  }

  if (outcome.evaluation.parsedResult.inferredResult === "pass") {
    return {
      ...baseResult,
      status: "ready_for_next_feature",
      reason: "The reviewed Unity playtest produced a recorded runtime-auto pass outcome for this feature.",
      recommended_next_action: PASS_ACTION,
      confidence: "high",
    };
  }

  if (outcome.evaluation.parsedResult.inferredResult === "fail") {
    return {
      ...baseResult,
      status: "retry_recommended",
      reason: "The reviewed Unity playtest produced a recorded runtime-auto fail outcome for this feature.",
      recommended_next_action: FAIL_ACTION,
      confidence: "high",
    };
  }

  return {
    ...baseResult,
    status: "escalation_recommended",
    reason: "The reviewed Unity playtest evidence stayed ambiguous, so AI-E cannot safely choose between advancing and retrying.",
    recommended_next_action: ESCALATION_ACTION,
    confidence: "low",
  };
}