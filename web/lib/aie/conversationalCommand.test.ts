import assert from "node:assert/strict";
import test from "node:test";

import { processConversationalCommand } from "./conversationalCommand";

test("command processing produces planner-facing proposal without execution", () => {
  const result = processConversationalCommand({
    rawRequest: "make enemies smarter when grenade blows up",
    projectName: "BABYLON Unity gameplay project",
    repoName: "AI-E",
  }, "operator-chat-session", "2026-04-26T12:01:00.000Z");

  assert.equal(result.decision.route, "review");
  assert.ok(result.response.proposal);
  assert.equal(result.response.proposal?.safe_to_execute, false);
  assert.match(result.response.assistant_message, /needs operator review/i);
});

test("command processing blocks unsafe autonomy requests", () => {
  const result = processConversationalCommand({
    rawRequest: "do everything automatically overnight",
  }, "operator-chat-session", "2026-04-26T12:01:00.000Z");

  assert.equal(result.decision.route, "block");
  assert.match(result.response.assistant_message, /blocking this request/i);
});

test("production pipeline requests stay in advisory planning and do not execute directly", () => {
  const result = processConversationalCommand({
    rawRequest: "plan the Unity audio asset pipeline for new OpenClaw ambience imports",
    projectName: "OpenClaw Unity production project",
    repoName: "AI-E",
  }, "operator-chat-session", "2026-04-30T12:01:00.000Z");

  assert.ok(result.response.proposal);
  assert.equal(result.response.proposal?.safe_to_execute, false);
  assert.ok(result.response.proposal?.production_pipeline_plan);
  assert.deepEqual(result.response.proposal?.production_pipeline_plan?.domains, ["assets", "audio", "unity-integration"]);
  assert.ok(result.response.proposal?.production_pipeline_plan?.unity_planning_packet);
  assert.match(result.response.proposal?.production_pipeline_plan?.execution_path ?? "", /Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control/);
});

test("Unity integration requests thread Unity planning packet metadata into the advisory proposal flow", () => {
  const result = processConversationalCommand({
    rawRequest: "prepare a Unity scene and prefab validation plan for the castle hub room",
    projectName: "OpenClaw Unity production project",
    repoName: "AI-E",
  }, "operator-chat-session", "2026-04-30T12:45:00.000Z");

  assert.ok(result.response.proposal?.production_pipeline_plan?.unity_planning_packet);
  assert.deepEqual(result.response.proposal?.production_pipeline_plan?.unity_planning_packet?.request_types, [
    "scene_request",
    "prefab_request",
    "validation_playtest_request",
  ]);
  assert.match(result.response.assistant_message, /operator approval is still required|needs operator review/i);
  assert.equal(result.response.proposal?.safe_to_execute, false);
  assert.equal(result.response.proposal?.production_pipeline_plan?.unity_validation_execution_result, null);
});

test("chat remains receptionist-only for Unity mutation requests", () => {
  const result = processConversationalCommand({
    rawRequest: "spawn a new checkpoint anchor directly into the EnemyAIDemo Unity scene right now",
    projectName: "OpenClaw Unity production project",
    repoName: "AI-E",
  }, "operator-chat-session", "2026-04-30T19:05:00.000Z");

  assert.ok(result.response.proposal);
  assert.equal(result.response.proposal?.safe_to_execute, false);
  assert.match(result.response.assistant_message, /operator approval is still required|needs operator review/i);
});

test("chat remains receptionist-only for Unity mutation execution plan requests", () => {
  const result = processConversationalCommand({
    rawRequest: "execute the final reviewed Unity mutation plan for CheckpointAnchor in EnemyAIDemo",
    projectName: "OpenClaw Unity production project",
    repoName: "AI-E",
  }, "operator-chat-session", "2026-05-01T12:10:00.000Z");

  assert.ok(result.response.proposal);
  assert.equal(result.response.proposal?.safe_to_execute, false);
  assert.match(result.response.assistant_message, /operator approval is still required|needs operator review/i);
});