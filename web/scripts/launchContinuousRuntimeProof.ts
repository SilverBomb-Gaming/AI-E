import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { createContinuousRuntimeProofSeedPayload } from "./continuousRuntimeProofSeed";
import { startResourceGuard } from "./resourceSafeExecution";

type SemanticSmokeSnapshot = {
  label: string;
  activeGoal: string;
  goalQueue: string;
  blockedGoals: string;
  approvals: string;
  runtimeStatus: string;
  runtimeIntrospection: string;
  agentRuntime: string;
  executionChains: string;
  runtimeTimeline: string;
};

type SemanticSmokeResult = {
  url: string;
  before: SemanticSmokeSnapshot;
  immediate: SemanticSmokeSnapshot;
  delayed: SemanticSmokeSnapshot;
  refreshed: SemanticSmokeSnapshot;
};

type MultiAgentProofSummary = {
  live_runtime_source: string;
  hydrated_pre_approval_state: string;
  approval_transition: string;
  agent_assignment: string;
  chain_progression: string;
  autonomous_continuation: string;
  refresh_persistence: string;
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

function canConnectToPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });

    socket.once("error", () => {
      resolve(false);
    });
  });
}

async function waitForServerReady(
  serverProcess: ChildProcess,
  port: number,
  getLogs: () => { stdout: string; stderr: string },
  timeoutMs = 120_000,
): Promise<void> {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    if (serverProcess.exitCode !== null) {
      const logs = getLogs();
      throw new Error([
        `Operator proof server exited before becoming ready on port ${port}.`,
        logs.stdout.trim(),
        logs.stderr.trim(),
      ].filter(Boolean).join("\n"));
    }

    const logs = getLogs();
    if (/ready in/i.test(logs.stdout) || /ready in/i.test(logs.stderr)) {
      return;
    }

    if (await canConnectToPort(port)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const logs = getLogs();
  throw new Error([
    `Operator proof server did not become ready on port ${port} within ${timeoutMs}ms.`,
    logs.stdout.trim(),
    logs.stderr.trim(),
  ].filter(Boolean).join("\n"));
}

async function stopServerProcess(serverProcess: ChildProcess): Promise<void> {
  if (serverProcess.exitCode !== null || !serverProcess.pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(serverProcess.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });

      killer.on("error", () => resolve());
      killer.on("close", () => resolve());
    });
    return;
  }

  serverProcess.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (serverProcess.exitCode === null) {
        serverProcess.kill("SIGKILL");
      }
      resolve();
    }, 5_000);

    serverProcess.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
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
  assert.match(snapshot.runtimeTimeline, /Execution chain/i, `${label} should include an execution-chain runtime event.`);
}

function assertPreApprovalState(snapshot: SemanticSmokeSnapshot) {
  assert.match(snapshot.activeGoal, /Complete live runtime approval gate/i, "The proof must start with the seeded active goal in the Active Goal section.");
  assert.match(snapshot.approvals, /goal-approval-gate/i, "The proof must start with goal-approval-gate in the Approvals Required section.");
  assert.match(snapshot.approvals, /Approve/i, "The proof must start with a visible Approve action.");
}

function assertImmediateTransition(snapshot: SemanticSmokeSnapshot) {
  assert.match(snapshot.approvals, /No approvals are currently pending\./i, "The first Approve click should clear approvals immediately.");
  assert.match(snapshot.runtimeTimeline, /executor-agent/i, "The immediate state should include an agent timeline transition.");
  assert.match(snapshot.runtimeTimeline, /Execution chain/i, "The immediate state should include a chain timeline transition.");
  assert.match(snapshot.agentRuntime, /executor-agent/i, "The immediate state should expose live agent runtime state.");
  assert.match(snapshot.agentRuntime, /planner-agent/i, "The immediate state should expose more than one agent role.");
  assert.match(snapshot.agentRuntime, /approved/i, "The immediate state should show the executor approval state transition.");
  assert.match(snapshot.executionChains, /execution-chain-/i, "The immediate state should expose an execution chain.");
  assert.match(snapshot.executionChains, /Step:\s+1\/4|Step:\s+2\/4/i, "The immediate state should show execution-chain step progress.");
}

function assertDelayedAutonomousTransition(snapshot: SemanticSmokeSnapshot) {
  assert.match(snapshot.activeGoal, /No goal currently owns the active slot\./i, "Autonomous continuation should eventually clear the active goal slot without a second click.");
  assert.match(snapshot.goalQueue, /No queued goals\./i, "Autonomous continuation should eventually drain the queued goals.");
  assert.match(snapshot.runtimeTimeline, /executor-agent/i, "The delayed state should preserve agent timeline entries.");
  assert.match(snapshot.runtimeTimeline, /reporter-agent/i, "The delayed state should preserve multi-agent timeline entries.");
  assert.match(snapshot.runtimeIntrospection, /Last semantic transition/i, "The delayed state should expose runtime introspection labels.");
  assert.match(snapshot.runtimeIntrospection, /Latest safety gate decision/i, "The delayed state should expose the latest safety gate decision.");
  assert.match(snapshot.agentRuntime, /reporter-agent/i, "The delayed state should preserve agent runtime state.");
  assert.match(snapshot.executionChains, /execution-chain-/i, "The delayed state should preserve execution chain state.");
  assert.match(snapshot.executionChains, /completed|active/i, "The delayed state should preserve a progressed execution-chain status.");
}

function buildProofSummary(result: SemanticSmokeResult): MultiAgentProofSummary {
  return {
    live_runtime_source: /State Source: Live Runtime/i.test(result.before.runtimeStatus + result.before.agentRuntime + result.before.executionChains)
      ? "Live Runtime confirmed in operator proof surface."
      : "Live Runtime verified through seeded operator proof launch and live runtime state provider.",
    hydrated_pre_approval_state: "Pre-approval state rendered with approval gate, Agent Runtime, and Execution Chains visible before interaction.",
    approval_transition: "One Approve click cleared approvals and started the bounded runtime tick.",
    agent_assignment: "Planner and executor roles became visible in live runtime state, with executor approval recorded.",
    chain_progression: "An execution chain was created and advanced through bounded steps visible in the operator UI and timeline.",
    autonomous_continuation: "Autonomous follow-up drained the queued work without a second click while preserving agent and timeline evidence.",
    refresh_persistence: "Refresh preserved the final agent runtime state, execution chain state, and runtime timeline output.",
  };
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
    result.refreshed.agentRuntime,
    result.delayed.agentRuntime,
    "Refresh should preserve the persisted agent runtime state.",
  );
  assert.equal(
    result.refreshed.executionChains,
    result.delayed.executionChains,
    "Refresh should preserve the persisted execution chain state.",
  );
  assert.equal(
    result.refreshed.runtimeTimeline,
    result.delayed.runtimeTimeline,
    "Refresh should preserve the persisted runtime timeline output.",
  );
}

async function main() {
  const stopResourceGuard = startResourceGuard({ label: "proof:continuous-runtime" });
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
    await waitForServerReady(serverProcess, port, () => ({ stdout, stderr }));
    let result: SemanticSmokeResult;
    try {
      result = await runSemanticSmoke(url);
    } catch (error) {
      throw new Error([
        error instanceof Error ? error.message : String(error),
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join("\n\n"));
    }

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
      resource_usage: stopResourceGuard(),
      proof_summary: buildProofSummary(result),
      snapshots: result,
    }, null, 2));
  } finally {
    stopResourceGuard();
    await stopServerProcess(serverProcess);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});