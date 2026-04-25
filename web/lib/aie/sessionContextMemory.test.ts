import assert from "node:assert/strict";
import test from "node:test";

import {
  answerConversationalLoopQuestion,
  startConversationalLoop,
} from "./multiTurnConversationalLoop";
import {
  createSessionContext,
  extractPreferences,
  getContextAugmentedRequest,
  summarizeSessionContext,
  updateSessionContext,
} from "./sessionContextMemory";

function buildPlannerReadyLoopSession() {
  const started = startConversationalLoop({
    rawRequest: "make game better",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });
  const afterFirst = answerConversationalLoopQuestion(started.session, { answer: "enemies first", answeredAt: "2026-04-24T10:01:00.000Z" });
  const openQuestion = afterFirst.session.questions.find((question) => !question.answered)?.question_id;
  assert.ok(openQuestion);
  const afterSecond = answerConversationalLoopQuestion(afterFirst.session, {
    question_id: openQuestion,
    answer: "when grenade blows up",
    answeredAt: "2026-04-24T10:02:00.000Z",
  });
  assert.equal(afterSecond.status, "planner_ready");
  return afterSecond.session;
}

test("planner_ready session updates context", () => {
  const context = createSessionContext("session-1", "2026-04-24T10:00:00.000Z");
  const loopSession = buildPlannerReadyLoopSession();
  const result = updateSessionContext(context, loopSession);

  assert.equal(result.context.recent_intents.length, 1);
  assert.equal(result.context.last_planner_ready_request, "Add enemy reaction behavior to grenade explosions in BABYLON.");
});

test("preferences extracted correctly", () => {
  const loopSession = buildPlannerReadyLoopSession();
  const preferences = extractPreferences(loopSession);

  assert.ok(preferences.some((preference) => preference.value === "enemies"));
  assert.ok(preferences.some((preference) => /enemy behavior/i.test(preference.value)));
});

test("new request gets context augmentation", () => {
  const context = updateSessionContext(createSessionContext("session-1"), buildPlannerReadyLoopSession()).context;
  const augmented = getContextAugmentedRequest(context, {
    rawRequest: "improve combat feel",
    projectName: "BABYLON Unity gameplay project",
  });

  assert.ok(augmented.operatorContext?.some((item) => /Session preference: enemies/i.test(item)));
  assert.ok(augmented.knownConstraints?.some((item) => /Recent planner-ready request/i.test(item)));
});

test("irrelevant context is ignored", () => {
  const context = updateSessionContext(createSessionContext("session-1"), buildPlannerReadyLoopSession()).context;
  const augmented = getContextAugmentedRequest(context, {
    rawRequest: "update the README formatting",
    repoName: "AI-E",
  });

  assert.equal(augmented.operatorContext?.length ?? 0, 0);
  assert.equal(augmented.knownConstraints?.length ?? 0, 0);
});

test("newer intent overrides older intent", () => {
  const baseContext = createSessionContext("session-1", "2026-04-24T10:00:00.000Z");
  const firstLoopSession = buildPlannerReadyLoopSession();
  const firstContext = updateSessionContext(baseContext, firstLoopSession).context;

  const secondLoopSession = {
    ...firstLoopSession,
    updated_at: "2026-04-24T11:00:00.000Z",
    current_interpretation: "Improve enemy behavior during close combat.",
    planner_ready_request: {
      ...firstLoopSession.planner_ready_request!,
      rawRequest: "Improve enemy close-combat behavior in BABYLON.",
    },
  };

  const secondContext = updateSessionContext(firstContext, secondLoopSession).context;
  assert.equal(secondContext.recent_intents[0]?.planner_ready_request, "Improve enemy close-combat behavior in BABYLON.");
});

test("confidence history updates", () => {
  const context = createSessionContext("session-1");
  const result = updateSessionContext(context, buildPlannerReadyLoopSession());

  assert.ok(result.context.confidence_history[0] && result.context.confidence_history[0] > 0);
});

test("summary is readable", () => {
  const context = updateSessionContext(createSessionContext("session-1"), buildPlannerReadyLoopSession()).context;
  const summary = summarizeSessionContext(context);

  assert.match(summary, /Session context:/i);
  assert.match(summary, /Recurring targets:/i);
  assert.match(summary, /Preferences:/i);
});

test("no raw chat logs stored", () => {
  const context = updateSessionContext(createSessionContext("session-1"), buildPlannerReadyLoopSession()).context;

  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /loop-turn-|original_request|question_id|turn_id/i);
});

test("context remains deterministic", () => {
  const loopSession = buildPlannerReadyLoopSession();
  const first = updateSessionContext(createSessionContext("session-1", "2026-04-24T10:00:00.000Z"), loopSession).context;
  const second = updateSessionContext(createSessionContext("session-1", "2026-04-24T10:00:00.000Z"), loopSession).context;

  assert.deepEqual(second, first);
});

test("works with multi-turn conversational loop output", () => {
  const loopSession = buildPlannerReadyLoopSession();
  const result = updateSessionContext(createSessionContext(loopSession.session_id), loopSession);

  assert.equal(result.context.session_id, loopSession.session_id);
  assert.ok(result.context.recent_intents[0]?.interpreted_intent.includes("enemy"));
});