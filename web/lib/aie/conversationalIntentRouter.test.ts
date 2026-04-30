import assert from "node:assert/strict";
import test from "node:test";

import { routeConversationalIntent } from "./conversationalIntentRouter";

test("clear request routes to plan with operator gate notice", () => {
  const result = routeConversationalIntent({
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  });

  assert.equal(result.route, "review");
  assert.equal(result.readiness.status, "needs_review");
  assert.match(result.operator_notice, /operator review/i);
});

test("vague request routes to clarification", () => {
  const result = routeConversationalIntent({
    rawRequest: "make the game better",
  });

  assert.equal(result.route, "clarify");
  assert.equal(result.readiness.status, "needs_clarification");
});

test("unsafe request routes to block", () => {
  const result = routeConversationalIntent({
    rawRequest: "do everything automatically overnight",
  });

  assert.equal(result.route, "block");
  assert.equal(result.readiness.status, "blocked");
});