import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlannerReadinessPacket,
  evaluateConversationalReadiness,
  listConversationalReadinessBlockers,
  summarizeConversationalReadiness,
} from "./conversationalReadinessOrchestrator";
import { startConversationalLoop } from "./multiTurnConversationalLoop";
import { createSessionContext, updateSessionContext } from "./sessionContextMemory";
import { refineConversationalIntent } from "./conversationalIntentRefinement";

test("clear request returns ready_for_planning", () => {
  const context = createSessionContext("readiness-clear");
  const result = evaluateConversationalReadiness({
    rawRequest: "enemy no react grenade",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
    sessionContext: context,
  });

  assert.equal(result.status, "ready_for_planning");
  assert.ok(result.planner_ready_request);
});

test("vague request returns needs_clarification", () => {
  const result = evaluateConversationalReadiness({
    rawRequest: "make it better",
    projectName: "OpenClaw",
    sessionContext: createSessionContext("readiness-vague"),
  });

  assert.equal(result.status, "needs_clarification");
});

test("broad autonomy request returns blocked", () => {
  const result = evaluateConversationalReadiness({
    rawRequest: "do everything automatically overnight",
    sessionContext: createSessionContext("readiness-blocked"),
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some((blocker) => blocker.code === "unbounded-autonomy" || blocker.code === "unsafe-request"));
});

test("medium-risk request returns needs_review", () => {
  const refinement = refineConversationalIntent({
    rawRequest: "change movement feel across the whole game",
    projectName: "OpenClaw",
  });
  const result = evaluateConversationalReadiness({
    rawRequest: "change movement feel across the whole game",
    projectName: "OpenClaw",
    sessionContext: createSessionContext("readiness-review"),
    refinementResult: {
      ...refinement,
      risk_level: "medium",
    },
  });

  assert.equal(result.status, "needs_review");
});

test("context carryover improves readiness", () => {
  const started = startConversationalLoop({
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });
  const updatedContext = updateSessionContext(createSessionContext("readiness-context"), started.session).context;

  const withoutContext = evaluateConversationalReadiness({
    rawRequest: "same enemy grenade behavior",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });
  const withContext = evaluateConversationalReadiness({
    rawRequest: "same enemy grenade behavior",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
    sessionContext: updatedContext,
  });

  assert.ok(withContext.confidence_score > withoutContext.confidence_score);
});

test("conflicting context triggers needs_review", () => {
  const started = startConversationalLoop({
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });
  const updatedContext = updateSessionContext(createSessionContext("readiness-conflict"), started.session).context;

  const result = evaluateConversationalReadiness({
    rawRequest: "same as before but docs and tests this time",
    projectName: "AI-E",
    repoName: "AI-E",
    sessionContext: updatedContext,
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.session_context_conflict, true);
});

test("tone guidance is included", () => {
  const result = evaluateConversationalReadiness({
    rawRequest: "next handoff please",
    sessionContext: createSessionContext("readiness-tone"),
  });

  assert.equal(result.tone_guidance.response_mode, "handoff_only");
});

test("confidence ambiguity and completeness are included", () => {
  const result = evaluateConversationalReadiness({
    rawRequest: "enemy no react grenade",
    sessionContext: createSessionContext("readiness-scores"),
  });

  assert.equal(typeof result.confidence_score, "number");
  assert.equal(typeof result.ambiguity_score, "number");
  assert.equal(typeof result.completeness_score, "number");
});

test("planner readiness packet preserves original and normalized input", () => {
  const packet = buildPlannerReadinessPacket({
    rawRequest: "enemy no react grenade",
    sessionContext: createSessionContext("readiness-packet"),
  });

  assert.equal(packet.original_request, "enemy no react grenade");
  assert.equal(packet.normalized_input, "improve enemy reaction to grenades");
});

test("summary is readable", () => {
  const result = evaluateConversationalReadiness({
    rawRequest: "enemy no react grenade",
    sessionContext: createSessionContext("readiness-summary"),
  });
  const summary = summarizeConversationalReadiness(result);

  assert.match(summary, /Readiness:/i);
  assert.match(summary, /Confidence:/i);
  assert.match(summary, /Tone mode:/i);
  assert.match(summary, /Explanation:/i);
});

test("works with existing loop refinement and context outputs", () => {
  const loopResult = startConversationalLoop({
    rawRequest: "enemy no react grenade",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });
  const context = updateSessionContext(createSessionContext("readiness-existing"), loopResult.session).context;
  const result = evaluateConversationalReadiness({
    rawRequest: "enemy no react grenade",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
    loopResult,
    refinementResult: loopResult.session.latest_refinement,
    sessionContext: context,
    toneGuidance: loopResult.session.tone_adaptation,
  });
  const blockers = listConversationalReadinessBlockers({
    rawRequest: "enemy no react grenade",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
    loopResult,
    refinementResult: loopResult.session.latest_refinement,
    sessionContext: context,
    toneGuidance: loopResult.session.tone_adaptation,
  });

  assert.equal(result.status, "ready_for_planning");
  assert.ok(Array.isArray(blockers));
});