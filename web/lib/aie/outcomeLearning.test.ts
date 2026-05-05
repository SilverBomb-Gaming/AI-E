import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildLearnedPattern, recordOutcome, summarizeOutcomeLearning } from "./outcomeLearning";

test("outcome learning records append-only JSONL entries", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-outcome-learning-"));

  try {
    const first = await recordOutcome(tempRoot, {
      feature: "attack-feedback",
      result: "pass",
      observation: "Enemy flashes red and pulses.",
    });
    const second = await recordOutcome(tempRoot, {
      feature: "enemy-health",
      result: "fail",
      observation: "Enemy never deactivated after three hits.",
    });

    const source = await readFile(first.logPath, "utf-8");
    const lines = source.trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
    assert.equal((JSON.parse(lines[0]) as { id: string; }).id, first.record.id);
    assert.equal((JSON.parse(lines[1]) as { id: string; }).id, second.record.id);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("outcome learning summary reports counts and latest patterns", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-outcome-summary-"));

  try {
    await recordOutcome(tempRoot, {
      feature: "attack-feedback",
      result: "pass",
      observation: "Mouse0 and E both hit.",
    });
    await recordOutcome(tempRoot, {
      feature: "enemy-health",
      result: "partial",
      observation: "Enemy health decrements but death animation needs follow-up.",
      rollbackUsed: true,
    });
    await recordOutcome(tempRoot, {
      feature: "enemy-health",
      result: "fail",
      observation: "Enemy never disabled itself.",
    });

    const summary = await summarizeOutcomeLearning(tempRoot);
    assert.equal(summary.totalOutcomes, 3);
    assert.equal(summary.passCount, 1);
    assert.equal(summary.failCount, 1);
    assert.equal(summary.partialCount, 1);
    assert.equal(summary.rollbackCount, 1);
    assert.equal(summary.latestSuccessfulPatterns[0], buildLearnedPattern("attack-feedback", "operator-recorded playtest validation", "pass", "Mouse0 and E both hit."));
    assert.equal(summary.latestFailurePatterns[0], buildLearnedPattern("enemy-health", "operator-recorded playtest validation", "fail", "Enemy never disabled itself."));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});