import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { formatHeadlessSessionReport, formatHeadlessSessionSummary, runHeadlessAutonomy } from "./headless_autonomy";
import type { FreeAnalysisResponse } from "./lib/aie/types";

test("headless_autonomy persists a bounded session and prints a matching summary", async () => {
  const sessionDirectory = path.resolve(process.cwd(), "temp-headless-session-store");
  process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
  await mkdir(sessionDirectory, { recursive: true });

  try {
    const session = await runHeadlessAutonomy(
      {
        goal: "Confirm a safe bounded headless validation result.",
        maxSteps: 2,
        cwd: process.cwd(),
      },
      {
        runAnalysis: async () => ({
          what_happened: "The headless validation confirmed the expected healthy output and resolved the bounded goal.",
          what_matters: ["The headless path should still reuse the same bounded runner."],
          what_to_do_next: ["Stop."],
          upgrade_hint: "",
          proposedAction: "Validate the bounded headless output.",
          expectedOutcome: "The healthy bounded output should be confirmed.",
          execution: {
            id: "headless-validate",
            type: "validation-check",
            scope: "safe",
            description: "Validate the bounded headless output.",
            expectedOutcome: "The healthy bounded output should be confirmed.",
            requiresApproval: true,
            metadata: {
              sourceActionType: "validation-check",
            },
          },
        }) as FreeAnalysisResponse,
        executeAction: async () => ({
          status: "success",
          output: "Healthy status confirmed, issue resolved, and expected outcome validated successfully.",
        }),
        saveAutonomousSession: async () => {},
      },
    );
    const summary = JSON.parse(formatHeadlessSessionSummary(session)) as Record<string, unknown>;

    assert.equal(typeof summary.sessionId, "string");
    assert.equal(summary.status, session.status);
    assert.equal(summary.completionStatus, session.latestCompletion?.status ?? null);
    assert.equal(summary.adapter, "headless-local");
    assert.match(formatHeadlessSessionReport(session, { verbose: true }), /Step 1/i);
    assert.match(formatHeadlessSessionReport(session, { json: true, verbose: true }), /"sessionId"/i);
  } finally {
    delete process.env.AIE_AUTONOMOUS_SESSION_DIR;
    await rm(sessionDirectory, { recursive: true, force: true });
  }
});