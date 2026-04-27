import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { createContinuousRuntimeProofSeedPayload } from "./continuousRuntimeProofSeed";

type SemanticSmokeSnapshot = {
  label: string;
  activeGoal: string;
  goalQueue: string;
  blockedGoals: string;
  approvals: string;
  runtimeStatus: string;
  runtimeIntrospection: string;
  runtimeTimeline: string;
};

type SemanticSmokeResult = {
  url: string;
  before: SemanticSmokeSnapshot;
  immediate: SemanticSmokeSnapshot;
  delayed: SemanticSmokeSnapshot;
  refreshed: SemanticSmokeSnapshot;
};

function tryPort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not resolve a free proof port.")));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function findAvailablePort(startPort = 3012, maxAttempts = 25): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidatePort = startPort + offset;
    try {
      return await tryPort(candidatePort);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
        throw error;
      }
    }
  }

  throw new Error(`Could not find a free proof port after trying ${maxAttempts} candidates starting at ${startPort}.`);
}

function createServerProcess(port: number): ChildProcess {
  const seeded = createContinuousRuntimeProofSeedPayload();
  const env = {
    ...process.env,
    AIE_OPERATOR_RUNTIME_ID: seeded.runtimeId,
    AIE_OPERATOR_RUNTIME_STATE_STORE_JSON: JSON.stringify(seeded.store),
  };

  if (process.platform === "win32") {
    return spawn(
      "cmd.exe",
      ["/d", "/s", "/c", `npm run dev -- --hostname 127.0.0.1 --port ${port}`],
      {
        cwd: process.cwd(),
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  }

  return spawn(
    "npm",
    ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function runSemanticSmoke(url: string): Promise<SemanticSmokeResult> {
  const smokeProcess = spawn(process.execPath, ["scripts/continuousRuntimeSemanticSmoke.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AIE_OPERATOR_SMOKE_URL: url,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  smokeProcess.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  smokeProcess.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    smokeProcess.on("error", reject);
    smokeProcess.on("close", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error([
      `Semantic smoke failed with exit code ${exitCode}.`,
      stderr.trim() || stdout.trim() || "No smoke output was captured.",
    ].join("\n"));
  }

  return JSON.parse(stdout) as SemanticSmokeResult;
}

function assertTimeline(snapshot: SemanticSmokeSnapshot, label: string) {
  assert.match(snapshot.runtimeTimeline, /Tick\s+1/i, `${label} should include at least one runtime timeline tick.`);
  assert.match(snapshot.runtimeTimeline, /Safety gate:\s+passed/i, `${label} should record a passed safety gate decision.`);
  assert.match(snapshot.runtimeTimeline, /Goal focus/i, `${label} should include a goal transition narrative.`);
}

function assertPreApprovalState(snapshot: SemanticSmokeSnapshot) {
  assert.match(snapshot.activeGoal, /Complete live runtime approval gate/i, "The proof must start with the seeded active goal in the Active Goal section.");
  assert.match(snapshot.approvals, /goal-approval-gate/i, "The proof must start with goal-approval-gate in the Approvals Required section.");
  assert.match(snapshot.approvals, /Approve/i, "The proof must start with a visible Approve action.");
}

function assertImmediateTransition(snapshot: SemanticSmokeSnapshot) {
  assert.match(snapshot.approvals, /No approvals are currently pending\./i, "The first Approve click should clear approvals immediately.");
  assert.match(snapshot.runtimeTimeline, /Goal focus/i, "The immediate state should include a runtime timeline transition.");
}

function assertDelayedAutonomousTransition(snapshot: SemanticSmokeSnapshot) {
  assert.match(snapshot.activeGoal, /No goal currently owns the active slot\./i, "Autonomous continuation should eventually clear the active goal slot without a second click.");
  assert.match(snapshot.goalQueue, /No queued goals\./i, "Autonomous continuation should eventually drain the queued goals.");
  assert.match(snapshot.runtimeTimeline, /Goal focus/i, "The delayed state should preserve runtime timeline entries.");
  assert.match(snapshot.runtimeIntrospection, /Last semantic transition/i, "The delayed state should expose runtime introspection labels.");
  assert.match(snapshot.runtimeIntrospection, /Latest safety gate decision/i, "The delayed state should expose the latest safety gate decision.");
}

function assertRefreshPersistence(result: SemanticSmokeResult) {
  assert.equal(
    result.refreshed.activeGoal,
    result.delayed.activeGoal,
    "Refresh should preserve the active-goal completion state.",
  );
  assert.equal(
    result.refreshed.goalQueue,
    result.delayed.goalQueue,
    "Refresh should preserve the empty queue state after autonomous ticks complete.",
  );
  assert.equal(
    result.refreshed.approvals,
    result.delayed.approvals,
    "Refresh should preserve the cleared approvals state.",
  );
  assert.equal(
    result.refreshed.runtimeTimeline,
    result.delayed.runtimeTimeline,
    "Refresh should preserve the persisted runtime timeline output.",
  );
}

async function main() {
  const port = await findAvailablePort(Number(process.env.AIE_OPERATOR_PROOF_PORT ?? 3012));
  const url = `http://127.0.0.1:${port}/operator`;
  const serverProcess = createServerProcess(port);
  let stdout = "";
  let stderr = "";

  serverProcess.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  serverProcess.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const result = await runSemanticSmoke(url);

    assertPreApprovalState(result.before);
    assert.match(result.before.runtimeStatus, /runtime blocked/i, "The proof should begin with the runtime blocked pending approval.");
    assertImmediateTransition(result.immediate);
    assertDelayedAutonomousTransition(result.delayed);
    assertTimeline(result.immediate, "Immediate proof state");
    assertTimeline(result.delayed, "Delayed proof state");
    assertRefreshPersistence(result);

    process.stdout.write(JSON.stringify({
      status: "proof_passed",
      url,
      snapshots: result,
    }, null, 2));
  } finally {
    serverProcess.kill();
    if (serverProcess.exitCode === null && process.platform === "win32") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (serverProcess.exitCode !== 0 && serverProcess.exitCode !== null) {
      process.stderr.write([
        `Operator proof server exited with code ${serverProcess.exitCode}.`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join("\n"));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});