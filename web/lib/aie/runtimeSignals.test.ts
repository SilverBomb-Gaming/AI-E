import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  autoEvaluateUnityRuntime,
  discoverUnityLogCandidates,
  findBestUnityRuntimeLog,
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

test("runtime log discovery reports editor and project candidates and selects gameplay log", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-runtime-discovery-"));
  const localAppData = path.join(tempRoot, "LocalAppData");
  const userProfile = path.join(tempRoot, "UserProfile");
  const projectPath = path.join(tempRoot, "EnemyAIDemoStandalone");
  const editorLogPath = path.join(localAppData, "Unity", "Editor", "Editor.log");
  const playerLogPath = path.join(userProfile, "AppData", "LocalLow", "DefaultCompany", "EnemyAIDemoStandalone", "Player.log");
  const projectLogPath = path.join(projectPath, "Library", "Logs", "playtest.log");

  process.env.LOCALAPPDATA = localAppData;
  process.env.USERPROFILE = userProfile;

  try {
    await mkdir(path.dirname(editorLogPath), { recursive: true });
    await mkdir(path.dirname(playerLogPath), { recursive: true });
    await mkdir(path.dirname(projectLogPath), { recursive: true });
    await writeFile(editorLogPath, "Editor started", "utf-8");
    await writeFile(playerLogPath, "No gameplay signals yet", "utf-8");
    await writeFile(projectLogPath, [
      "Enemy hit",
      "Enemy defeated",
      "AIE runtime verification",
    ].join("\n"), "utf-8");

    const discovery = await discoverUnityLogCandidates(projectPath);
    assert.ok(discovery.candidates.some((candidate) => candidate.path === editorLogPath && candidate.kind === "editor"));
    assert.ok(discovery.candidates.some((candidate) => candidate.path === projectLogPath && candidate.kind === "project" && candidate.containsGameplaySignals));

    const bestLog = await findBestUnityRuntimeLog(projectPath);
    assert.equal(bestLog.selectedPath, projectLogPath);

    const evaluation = await autoEvaluateUnityRuntime(projectPath);
    assert.equal(evaluation.logPath, projectLogPath);
    assert.equal(evaluation.parsedResult.inferredResult, "pass");
  } finally {
    delete process.env.LOCALAPPDATA;
    delete process.env.USERPROFILE;
    await rm(tempRoot, { recursive: true, force: true });
  }
});