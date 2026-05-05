import assert from "node:assert/strict";
import test from "node:test";

import { selectPostPlaytestStrategy } from "./postPlaytestStrategySelector";

test("retry selects minimal_code_patch by default", () => {
  const result = selectPostPlaytestStrategy({
    decision: {
      status: "retry_recommended",
      reason: "Failure evidence suggests a bounded retry.",
      recommended_next_action: "Review failure evidence, apply the smallest safe fix, then rerun the reviewed Unity playtest.",
      confidence: "high",
      source_feature: "enemy-health",
      source_outcome_session_key: "session-retry-default",
    },
  });

  assert.equal(result.status, "strategy_selected");
  assert.equal(result.selected_strategy_id, "minimal_code_patch");
  assert.equal(result.selected_strategy_label, "Minimal code patch");
});

test("failed prior strategy causes next different strategy", () => {
  const result = selectPostPlaytestStrategy({
    decision: {
      status: "retry_recommended",
      reason: "Failure evidence suggests another bounded retry.",
      recommended_next_action: "Review failure evidence, apply the smallest safe fix, then rerun the reviewed Unity playtest.",
      confidence: "high",
      source_feature: "enemy-health",
      source_outcome_session_key: "session-retry-different",
    },
    failed_strategy_ids: ["minimal_code_patch"],
  });

  assert.equal(result.status, "strategy_selected");
  assert.equal(result.selected_strategy_id, "test_or_marker_adjustment");
  assert.ok(result.rejection_reasons.some((reason) => /minimal_code_patch/i.test(reason)));
});

test("no safe candidate yields strategy_blocked", () => {
  const result = selectPostPlaytestStrategy({
    decision: {
      status: "retry_recommended",
      reason: "Failure evidence suggests another bounded retry.",
      recommended_next_action: "Review failure evidence, apply the smallest safe fix, then rerun the reviewed Unity playtest.",
      confidence: "high",
      source_feature: "enemy-health",
      source_outcome_session_key: "session-retry-blocked",
    },
    allowed_file_scopes: ["docs"],
  });

  assert.equal(result.status, "strategy_blocked");
  assert.equal(result.selected_strategy_id, null);
  assert.match(result.reason, /No safe bounded retry strategy/i);
});

test("ready_for_next_feature yields no_strategy_needed", () => {
  const result = selectPostPlaytestStrategy({
    decision: {
      status: "ready_for_next_feature",
      reason: "The feature is stable.",
      recommended_next_action: "Mark the feature stable and select the next validation target.",
      confidence: "high",
      source_feature: "enemy-health",
      source_outcome_session_key: "session-ready",
    },
  });

  assert.equal(result.status, "no_strategy_needed");
  assert.equal(result.selected_strategy_id, null);
});