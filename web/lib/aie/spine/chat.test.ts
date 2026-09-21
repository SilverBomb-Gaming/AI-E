import assert from "node:assert/strict";
import test from "node:test";

import { runDemoChat } from "./chat";

test("demo chat runs the planner tool on a Unity request", () => {
  const result = runDemoChat([
    { role: "user", content: "Plan a Unity third-person controller for a PC prototype" },
  ]);

  assert.equal(result.mode, "demo");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.name, "plan_bounded_request");
  assert.equal(result.toolCalls[0]?.result.status, "supported_ready");
  assert.match(result.reply, /did not execute engine work/i);
  assert.match(result.reply, /demo mode/i);
});

test("demo chat explains the spine when the user is just saying hello", () => {
  const result = runDemoChat([{ role: "user", content: "hello" }]);

  assert.equal(result.mode, "demo");
  assert.equal(result.toolCalls.length, 0);
  assert.match(result.reply, /plan_bounded_request/);
});

test("demo chat still runs the planner for an unsupported engine so the block is visible", () => {
  const result = runDemoChat([{ role: "user", content: "Make a Godot inventory system" }]);

  assert.equal(result.toolCalls[0]?.result.status, "unsupported_target");
  assert.match(result.reply, /unsupported/i);
});
