import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildRecentActionSummary,
  choosePreferredNextActionFamily,
  detectOverlyBroadPlanShift,
  derivePlanningHintsFromSession,
  deriveRepoAwarePlanningHintsFromSession,
} from "./autonomousPlanning";
import { appendAutonomousStep, createAutonomousSession } from "./autonomousSession";

test("choosePreferredNextActionFamily prefers test after a write with changed paths", () => {
  const session = appendAutonomousStep(createAutonomousSession({ goal: "Confirm the write then validate flow." }), {
    proposedAction: "Write web/sandbox/example.txt",
    actionFamily: "write",
    executionResult: {
      status: "success",
      output: "Sandbox file write completed.",
      changedPaths: ["web/sandbox/example.txt"],
    },
    diagnosis: "The write completed.",
  });

  assert.equal(choosePreferredNextActionFamily(session), "test");
});

test("detectOverlyBroadPlanShift flags subsystem jumps after recent failures", () => {
  let session = createAutonomousSession({ goal: "Keep the current lane narrow." });
  session = appendAutonomousStep(session, {
    proposedAction: "Run npm test",
    actionFamily: "test",
    executionResult: {
      status: "failed",
      error: "trace failed",
    },
    diagnosis: "The test lane failed.",
    nextDecision: "reroute",
  });

  assert.equal(detectOverlyBroadPlanShift(session, "Write a broad repo-wide patch"), true);
});

test("buildRecentActionSummary and derivePlanningHintsFromSession summarize recent action families", () => {
  let session = createAutonomousSession({ goal: "Summarize recent bounded actions." });
  session = appendAutonomousStep(session, {
    proposedAction: "Write web/sandbox/example.txt",
    actionFamily: "write",
    executionResult: {
      status: "success",
      output: "Sandbox file write completed.",
      changedPaths: ["web/sandbox/example.txt"],
    },
    diagnosis: "The write completed.",
  });
  session = appendAutonomousStep(session, {
    proposedAction: "Run npm test",
    actionFamily: "test",
    executionResult: {
      status: "success",
      output: "npm test passed",
      commandLabel: "npm test",
    },
    diagnosis: "The test completed.",
  });

  const summary = buildRecentActionSummary(session);
  const hints = derivePlanningHintsFromSession(session, "Validate the updated result banner.");

  assert.match(summary, /write:Sandbox file write completed/i);
  assert.match(summary, /test:npm test passed/i);
  assert.equal(hints.preferredNextActionFamily, "validate");
  assert.match(hints.hintSummary, /Preferred next lane: validate/i);
});

test("deriveRepoAwarePlanningHintsFromSession adds repo clusters and related test pairing", async () => {
  const fixtureRoot = path.resolve(process.cwd(), "temp-phase4f-planning-hints");
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(path.join(fixtureRoot, "web", "lib", "aie"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "web", "lib", "aie", "repoContext.ts"), "export const repoContext = true;\n", "utf8");
  await writeFile(path.join(fixtureRoot, "web", "lib", "aie", "repoContext.test.ts"), "export const repoContextTest = true;\n", "utf8");
  await writeFile(path.join(fixtureRoot, "web", "headless_autonomy.ts"), "export const headless = true;\n", "utf8");

  try {
    const session = appendAutonomousStep(createAutonomousSession({ goal: "Keep repo-aware scope narrow." }), {
      proposedAction: "Write web/lib/aie/repoContext.ts",
      actionFamily: "write",
      executionResult: {
        status: "success",
        output: "Repo context write completed.",
        changedPaths: ["web/lib/aie/repoContext.ts"],
      },
      diagnosis: "The repo context change completed.",
    });

    const hints = await deriveRepoAwarePlanningHintsFromSession(session, {
      repoRoot: fixtureRoot,
      nextActionText: "Run the paired repo context test.",
    });

    assert.equal(hints.preferredNextActionFamily, "test");
    assert.ok(hints.recentChangeClusters.some((cluster) => /web\/lib\/aie/i.test(cluster)));
    assert.ok(hints.relatedTestFiles.includes("web/lib/aie/repoContext.test.ts"));
    assert.ok(hints.entryPoints.includes("web/headless_autonomy.ts"));
    assert.match(hints.hintSummary, /Impact zones/i);
    assert.match(hints.hintSummary, /Pair with tests/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});