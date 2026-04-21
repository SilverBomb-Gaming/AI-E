import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAllowedExecutionPath,
  getDefaultAllowedExecutionRoots,
  isPathWithinAllowedRoot,
  normalizeExecutionPath,
} from "./executionPathPolicy";

test("normalizeExecutionPath keeps bounded repo-relative paths stable", () => {
  assert.equal(normalizeExecutionPath("web/sandbox/example.txt"), "web/sandbox/example.txt");
  assert.equal(normalizeExecutionPath("web\\sandbox\\nested\\example.txt"), "web/sandbox/nested/example.txt");
});

test("assertAllowedExecutionPath accepts sandbox paths and reports the matched root", () => {
  const allowedPath = assertAllowedExecutionPath("web/sandbox/example.txt");

  assert.equal(allowedPath.relativePath, "web/sandbox/example.txt");
  assert.equal(allowedPath.allowedRoot, "web/sandbox");
  assert.equal(isPathWithinAllowedRoot("web/sandbox/example.txt", "web/sandbox"), true);
  assert.ok(getDefaultAllowedExecutionRoots().includes("web/sandbox"));
});

test("assertAllowedExecutionPath blocks disallowed or out-of-root paths", () => {
  assert.throws(() => assertAllowedExecutionPath("../outside.txt"), /repository boundary|allowed execution policy/i);
  assert.throws(() => assertAllowedExecutionPath("web/node_modules/openai/index.js"), /allowed execution policy/i);
  assert.throws(() => assertAllowedExecutionPath("web/package.json"), /approved execution roots/i);
});