import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { createContinuousRuntimeProofSeedPayload } from "./continuousRuntimeProofSeed";
import { startResourceGuard } from "./resourceSafeExecution";

type AutonomousPlanningSnapshot = {
  label: string;
  stateSource: string;
  planning: string;
  reviewPackages: string;
  executionChains: string;
  runtimeIntrospection: string;
  runtimeTimeline: string;
};

type AutonomousPlanningProofResult = {
  url: string;
  before: AutonomousPlanningSnapshot;
  immediate: AutonomousPlanningSnapshot;
  delayed: AutonomousPlanningSnapshot;
  refreshed: AutonomousPlanningSnapshot;
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

async function findAvailablePort(startPort = 3014, maxAttempts = 25): Promise<number> {
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
  const seeded = createContinuousRuntimeProofSeedPayload({ mode: "autonomous-planning" });
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

async function runSemanticSmoke(url: string): Promise<AutonomousPlanningProofResult> {
  const smokeProcess = spawn(process.execPath, ["scripts/autonomousPlanningSemanticSmoke.js"], {
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

  return JSON.parse(stdout) as AutonomousPlanningProofResult;
}

function assertProof(result: AutonomousPlanningProofResult) {
  assert.match(result.before.stateSource, /live runtime/i, "The proof must use the live runtime source.");
  assert.match(result.before.planning, /Deterministic planning candidate/i, "The seeded proof must expose a proposed low-risk work item.");
  assert.match(result.before.planning, /High-risk planning escalation/i, "The seeded proof must expose a proposed high-risk work item.");
  assert.ok(
    result.before.planning.indexOf("Deterministic planning candidate: score 42") >= 0
      && result.before.planning.indexOf("High-risk planning escalation: score 11") >= 0
      && result.before.planning.indexOf("Deterministic planning candidate: score 42") < result.before.planning.indexOf("High-risk planning escalation: score 11"),
    "Deterministic prioritization must rank the low-risk work item ahead of the high-risk item.",
  );
  assert.match(result.before.planning, /Approval: operator_approval/i, "The seeded high-risk item must remain explicitly gated.");
  assert.match(result.immediate.executionChains, /planning-goal-1/i, "Operator approval must schedule work into an execution chain.");
  assert.match(result.immediate.runtimeTimeline, /planning-goal-1/i, "The runtime loop must execute the approved work item.");
  assert.match(result.delayed.executionChains, /completed/i, "The execution chain must reach a bounded completion state.");
  assert.match(result.delayed.planning, /Deterministic planning candidate[\s\S]*needs review/i, "The work item must transition to needs_review after completion.");
  assert.match(result.delayed.reviewPackages, /planning-goal-1/i, "A review package must be created for the completed planning work item.");
  assert.match(result.refreshed.reviewPackages, /planning-goal-1/i, "The review package must persist after refresh.");
  assert.match(result.delayed.runtimeIntrospection, /Latest safety gate decision[\s\S]*passed/i, "Safety gates must remain intact during the proof.");
  assert.match(result.delayed.reviewPackages, /No commit or push actions were attempted\./i, "The review package must preserve the bounded no-commit safety guarantee.");
}

async function main() {
  const stopResourceGuard = startResourceGuard({ label: "proof:autonomous-planning" });
  const port = await findAvailablePort(Number(process.env.AIE_OPERATOR_PROOF_PORT ?? 3014));
  const url = `http://127.0.0.1:${port}/operator`;
  const serverProcess = createServerProcess(port);
  let stdout = "";
  let stderr = "";

  if (serverProcess.stdout) {
    serverProcess.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
  }
  if (serverProcess.stderr) {
    serverProcess.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
  }

  try {
    await waitForServerReady(serverProcess, port, () => ({ stdout, stderr }));
    const result = await runSemanticSmoke(url);
    assertProof(result);

    process.stdout.write(JSON.stringify({
      status: "proof_passed",
      url,
      resource_usage: stopResourceGuard(),
      proof_summary: {
        live_runtime_source: "The operator dashboard rendered from the seeded live runtime store.",
        prioritization: "Deterministic ranking surfaced the low-risk planning candidate ahead of the high-risk gated item.",
        high_risk_gating: "The high-risk work item remained proposed with explicit operator_approval gating.",
        execution: "Approving the top-ranked work item scheduled it into the existing runtime loop and execution-chain path.",
        review_boundary: "The bounded chain completed, moved the work item to needs_review, and emitted a review package.",
        persistence: "Refreshing the live operator page preserved the review package and review-boundary state.",
        safety_gates: "Latest safety gate remained passed and the review package preserved the no-commit, no-push guarantee.",
      },
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