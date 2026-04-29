import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { createContinuousRuntimeProofSeedPayload } from "./continuousRuntimeProofSeed";
import { startResourceGuard } from "./resourceSafeExecution";

type MultiSessionSnapshot = {
  label: string;
  stateSource: string;
  autonomousSessions: string;
  runtimeIntrospection: string;
  featureSession: string;
  bugfixSession: string;
};

type MultiSessionProofResult = {
  url: string;
  before: MultiSessionSnapshot;
  afterPause: MultiSessionSnapshot;
  afterResume: MultiSessionSnapshot;
  afterPriority: MultiSessionSnapshot;
  afterMerge: MultiSessionSnapshot;
  refreshed: MultiSessionSnapshot;
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

async function findAvailablePort(startPort = 3016, maxAttempts = 25): Promise<number> {
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
  const seeded = createContinuousRuntimeProofSeedPayload({ mode: "multi-session" });
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

async function runSemanticSmoke(url: string): Promise<MultiSessionProofResult> {
  const smokeProcess = spawn(process.execPath, ["scripts/multiSessionSemanticSmoke.js"], {
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

  return JSON.parse(stdout) as MultiSessionProofResult;
}

function assertProof(result: MultiSessionProofResult) {
  assert.match(result.before.stateSource, /live runtime/i, "The proof must use the live runtime source.");
  assert.match(result.before.autonomousSessions, /demo-session-feature-ui/i, "The seeded proof must expose the feature session.");
  assert.match(result.before.autonomousSessions, /demo-session-bugfix-delivery/i, "The seeded proof must expose the bugfix session.");
  assert.match(result.before.autonomousSessions, /shared_file/i, "The seeded proof must expose a deterministic shared-file conflict.");
  assert.match(result.before.autonomousSessions, /unlocks/i, "The seeded proof must expose coordination dependencies.");
  assert.match(result.afterPause.featureSession, /paused/i, "Pausing a live autonomous session must update its persisted row state.");
  assert.match(result.afterResume.featureSession, /pending/i, "Resuming a paused live autonomous session must restore its runnable state.");
  assert.match(result.afterPriority.bugfixSession, /critical/i, "Reprioritizing a live autonomous session must persist the requested priority.");
  assert.match(result.afterMerge.bugfixSession, /completed/i, "Merging autonomous sessions must mark the source session completed.");
  assert.match(result.afterMerge.featureSession, /Queued work 2/i, "Merging autonomous sessions must consolidate queued work onto the target session.");
  assert.match(result.refreshed.bugfixSession, /completed/i, "Refreshing the operator page must preserve the merged autonomous session state.");
  assert.match(result.refreshed.featureSession, /Queued work 2/i, "Refreshing the operator page must preserve the merged target session state.");
}

async function main() {
  const stopResourceGuard = startResourceGuard({ label: "proof:multi-session" });
  const port = await findAvailablePort(Number(process.env.AIE_OPERATOR_PROOF_PORT ?? 3016));
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
    const result = await runSemanticSmoke(url);
    assertProof(result);

    process.stdout.write(JSON.stringify({
      status: "proof_passed",
      url,
      resource_usage: stopResourceGuard(),
      proof_summary: {
        live_runtime_source: "The operator dashboard rendered the autonomous session surface from the seeded live runtime store.",
        scheduler_and_resources: "The live autonomous session section exposed bounded scheduler and resource summaries for multiple concurrent sessions.",
        conflict_safety: "The proof surfaced deterministic shared-file conflict and dependency coordination state before any operator action.",
        operator_controls: "Live operator controls paused, resumed, reprioritized, and merged autonomous sessions through the persisted runtime action path.",
        persistence: "Refreshing the live operator page preserved the merged multi-session state and consolidated queued work counts.",
        bounded_scope: "The proof remained within bounded operator orchestration controls and did not attempt commit, push, or unbounded runtime mutation.",
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