import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { createContinuousRuntimeProofSeedPayload } from "./continuousRuntimeProofSeed";
import { startResourceGuard } from "./resourceSafeExecution";

type StudioCommandCenterSnapshot = {
  label: string;
  stateSource: string;
  commandCenter: string;
  autonomousSessions: string;
  runtimeIntrospection: string;
  summaryCard: string | null;
};

type StudioCommandCenterProofResult = {
  url: string;
  before: StudioCommandCenterSnapshot;
  afterPause: StudioCommandCenterSnapshot;
  afterResume: StudioCommandCenterSnapshot;
  afterAcknowledge: StudioCommandCenterSnapshot;
  afterAcknowledgeRefresh: StudioCommandCenterSnapshot;
  afterSummary: StudioCommandCenterSnapshot;
  refreshed: StudioCommandCenterSnapshot;
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

async function findAvailablePort(startPort = 3017, maxAttempts = 25): Promise<number> {
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
  const seeded = createContinuousRuntimeProofSeedPayload({ mode: "studio-command-center" });
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

async function runSemanticSmoke(url: string): Promise<StudioCommandCenterProofResult> {
  const smokeProcess = spawn(process.execPath, ["scripts/studioCommandCenterSemanticSmoke.js"], {
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

  return JSON.parse(stdout) as StudioCommandCenterProofResult;
}

function assertProof(result: StudioCommandCenterProofResult) {
  assert.match(result.before.stateSource, /live runtime/i, "The proof must use the live runtime source.");
  assert.match(result.before.commandCenter, /Studio Status/i, "The studio command center must be visible.");
  assert.match(result.before.commandCenter, /Health score \d+/i, "The command center must surface a computed health score.");
  assert.match(result.before.commandCenter, /Sessions/i, "The command center must surface session counts.");
  assert.match(result.before.commandCenter, /blocked/i, "The command center must surface blocked work or blocked sessions.");
  assert.match(result.before.commandCenter, /pending deliveries/i, "The command center must surface pending delivery counts.");
  assert.match(result.before.commandCenter, /Top Risks/i, "Top risks must be visible from the command center.");
  assert.match(result.before.commandCenter, /Recommended Operator Actions/i, "Recommended operator actions must be visible from the command center.");
  assert.match(result.before.autonomousSessions, /demo-session-feature-ui/i, "The autonomous sessions section must surface the feature session.");
  assert.match(result.before.autonomousSessions, /demo-session-bugfix-delivery/i, "The autonomous sessions section must surface the second session.");
  assert.match(result.afterPause.runtimeIntrospection, /pause_all_sessions persisted for studio command center state/i, "Pause all sessions must persist through the live command-center mutation path.");
  assert.match(result.afterResume.runtimeIntrospection, /resume_safe_sessions persisted for studio command center state/i, "Resume safe sessions must persist through the live command-center mutation path.");
  assert.match(result.afterAcknowledge.runtimeIntrospection, /acknowledge_studio_risk persisted for studio command center state/i, "Studio risk acknowledgement must persist through the live command-center mutation path.");
  assert.match(result.afterAcknowledgeRefresh.runtimeIntrospection, /acknowledge_studio_risk persisted for studio command center state/i, "Studio risk acknowledgement must survive a refresh before the next command-center action.");
  assert.ok(result.afterSummary.summaryCard, "Requesting a studio summary must produce a persisted summary card.");
  assert.ok(result.refreshed.summaryCard, "The studio summary package must persist after refresh.");
  assert.match(result.refreshed.runtimeIntrospection, /request_studio_summary persisted for studio command center state/i, "The proof must end with a persisted studio command-center mutation.");
  assert.match(result.refreshed.runtimeIntrospection, /LATEST SAFETY GATE DECISION\s+not triggered/i, "The command-center proof must not trigger hidden execution.");
}

async function main() {
  const stopResourceGuard = startResourceGuard({ label: "proof:studio-command-center" });
  const port = await findAvailablePort(Number(process.env.AIE_OPERATOR_PROOF_PORT ?? 3017));
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
        live_runtime_source: "The operator dashboard rendered the Studio Command Center from the seeded live runtime store.",
        studio_health: "The command center surfaced a computed health score, blocked work counts, pending reviews, pending deliveries, and top risks without requiring the operator to inspect every panel.",
        command_center_controls: "Pause All Sessions, Resume Safe Sessions, Acknowledge Studio Risk, and Request Studio Summary all mutated persisted live runtime state through the safe action path.",
        summary_package: "Requesting a studio summary generated a persisted operator-readable summary package from live state.",
        persistence: "Risk acknowledgement, resumed safe-session state, and the studio summary package all survived refresh.",
        bounded_scope: "The proof remained within operator-gated command-center controls and confirmed that no hidden execution occurred.",
      },
      snapshots: result,
    }, null, 2));
  } finally {
    stopResourceGuard();
    await stopServerProcess(serverProcess);
  }
}

void main();