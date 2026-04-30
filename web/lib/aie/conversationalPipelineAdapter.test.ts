import assert from "node:assert/strict";
import test from "node:test";

import {
  applyChatMessageToSession,
  applyChatOptionSelection,
  summarizeChatSession,
} from "./conversationalPipelineAdapter";
import { createInitialConversationalSession } from "./conversationalSessionState";

test("chat message creates advisory proposal and pending options", () => {
  const session = applyChatMessageToSession({
    session: createInitialConversationalSession("2026-04-26T12:00:00.000Z"),
    messageText: "make enemies smarter when grenade blows up",
    createdAt: "2026-04-26T12:01:00.000Z",
    requestContext: {
      projectName: "BABYLON Unity gameplay project",
      repoName: "AI-E",
    },
  });

  assert.equal(session.status, "awaiting_operator_choice");
  assert.ok((session.latest_proposal?.safe_to_execute ?? true) === false);
  assert.ok((session.pending_options.length ?? 0) >= 2);
  assert.match(session.operator_notice, /operator review|operator-gated|operator approval/i);
});

test("selecting a chat option records a notice without executing work", () => {
  const session = applyChatMessageToSession({
    session: createInitialConversationalSession("2026-04-26T12:00:00.000Z"),
    messageText: "make the game better",
    createdAt: "2026-04-26T12:01:00.000Z",
  });
  const optionId = session.pending_options[0]?.option_id;
  if (!optionId) {
    throw new Error("Expected a pending chat option.");
  }

  const updated = applyChatOptionSelection(session, optionId, "2026-04-26T12:02:00.000Z");

  assert.ok(updated);
  assert.match(updated?.operator_notice ?? "", /Selected option|Use Request Chat Summary|Use Archive Session/i);
});

test("chat summary stays advisory", () => {
  const session = applyChatMessageToSession({
    session: createInitialConversationalSession("2026-04-26T12:00:00.000Z"),
    messageText: "add unit tests for queue parsing and update the README example",
    createdAt: "2026-04-26T12:01:00.000Z",
    requestContext: {
      repoName: "AI-E",
    },
  });

  const summary = summarizeChatSession(session);
  assert.match(summary, /does not execute runtime work/i);
});

test("production pipeline chat requests capture planning-only proposal metadata", () => {
  const session = applyChatMessageToSession({
    session: createInitialConversationalSession("2026-04-30T12:00:00.000Z"),
    messageText: "prepare an art and Unity integration pipeline plan for HUD prefab updates",
    createdAt: "2026-04-30T12:01:00.000Z",
    requestContext: {
      projectName: "OpenClaw Unity production project",
      repoName: "AI-E",
    },
  });

  assert.ok(session.latest_proposal?.production_pipeline_plan);
  assert.equal(session.latest_proposal?.production_pipeline_plan?.mutation_policy, "planning_only");
  assert.deepEqual(session.latest_proposal?.production_pipeline_plan?.domains, ["assets", "art", "unity-integration"]);
});

test("Unity planning chat requests preserve advisory Unity packet metadata without executing work", () => {
  const session = applyChatMessageToSession({
    session: createInitialConversationalSession("2026-04-30T12:00:00.000Z"),
    messageText: "prepare a Unity scene prefab script validation plan for the boss arena",
    createdAt: "2026-04-30T12:03:00.000Z",
    requestContext: {
      projectName: "OpenClaw Unity production project",
      repoName: "AI-E",
    },
  });

  assert.equal(session.latest_proposal?.safe_to_execute, false);
  assert.ok(session.latest_proposal?.production_pipeline_plan?.unity_planning_packet);
  assert.deepEqual(session.latest_proposal?.production_pipeline_plan?.unity_planning_packet?.request_types, [
    "scene_request",
    "prefab_request",
    "component_script_request",
    "validation_playtest_request",
  ]);
});