import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  autoEvaluateUnityRuntime,
  inferRuntimeResult,
  parseRuntimeSignals,
} from "./runtimeSignals";

test("runtime signal extraction infers pass from gameplay events without errors", () => {
  const signals = parseRuntimeSignals([
    "Enemy hit",
    "Enemy defeated",
    "Attack missed",
  ].join("\n"));

  const parsed = inferRuntimeResult(signals);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.gameplayEvents.length, 3);
  assert.equal(parsed.inferredResult, "pass");
});

test("runtime signal extraction infers fail from runtime errors without gameplay success", () => {
  const signals = parseRuntimeSignals([
    "NullReferenceException: Object reference not set to an instance of an object",
    "error CS1002: ; expected",
  ].join("\n"));

  const parsed = inferRuntimeResult(signals);
  assert.equal(parsed.errors.length, 2);
  assert.equal(parsed.gameplayEvents.length, 0);
  assert.equal(parsed.inferredResult, "fail");
});

test("runtime signal extraction infers partial from mixed gameplay and runtime errors", () => {
  const signals = parseRuntimeSignals([
    "Enemy hit",
    "Enemy defeated",
    "Exception: test failure after gameplay event",
  ].join("\n"));

  const parsed = inferRuntimeResult(signals);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.gameplayEvents.length, 2);
  assert.equal(parsed.inferredResult, "partial");
});

test("runtime signal auto evaluation reads an override log path", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-runtime-signals-"));
  const logPath = path.join(tempRoot, "Player.log");

  try {
    await writeFile(logPath, [
      "Enemy hit",
      "Enemy defeated",
    ].join("\n"), "utf-8");

    const result = await autoEvaluateUnityRuntime(tempRoot, logPath);
    assert.equal(result.logPath, logPath);
    assert.equal(result.parsedResult.inferredResult, "pass");
    assert.match(result.reason.join(" "), /Enemy defeated/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});