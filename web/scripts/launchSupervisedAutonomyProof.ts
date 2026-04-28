import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { createContinuousRuntimeProofSeedPayload } from "./continuousRuntimeProofSeed";
import { startResourceGuard } from "./resourceSafeExecution";

type SupervisedAutonomySnapshot = {
  label: string;
  approvals: string;
  runtimeStatus: string;
  agentRuntime: string;
  supervisedSession: string;
  executionChains: string;
  runtimeTimeline: string;
};

type SupervisedAutonomyProofResult = {
  url: string;
  before: SupervisedAutonomySnapshot;
  afterApproval: SupervisedAutonomySnapshot;
  afterPause: SupervisedAutonomySnapshot;
  afterResume: SupervisedAutonomySnapshot;
  afterStop: SupervisedAutonomySnapshot;
  refreshed: SupervisedAutonomySnapshot;
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
  const seeded = createContinuousRuntimeProofSeedPayload({ mode: "supervised-autonomy" });
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

    socket.once("error", () => resolve(false));
  });
}

async function waitForServerReady(
  serverProcess: ChildProcess,
  port: number,
  getLogs: () => { stdout: string; stderr: string },
  timeoutMs = 60_000,
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

async function runSemanticSmoke(url: string): Promise<SupervisedAutonomyProofResult> {
  const smokeProcess = spawn(process.execPath, ["scripts/supervisedAutonomySemanticSmoke.js"], {
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

  return JSON.parse(stdout) as SupervisedAutonomyProofResult;
}

function assertPreApprovalState(snapshot: SupervisedAutonomySnapshot) {
  assert.match(snapshot.supervisedSession, /pending approval/i, "The proof should begin with a pending supervised session.");
  assert.match(snapshot.approvals, /goal-approval-gate/i, "The proof should begin with the seeded approval gate.");
}

function assertApprovalTransition(snapshot: SupervisedAutonomySnapshot) {
  assert.match(snapshot.supervisedSession, /running/i, "Approval should start the supervised session.");
  assert.match(snapshot.supervisedSession, /Latest Checkpoint/i, "Approval should produce a persisted checkpoint.");
  assert.match(snapshot.runtimeTimeline, /grant_session_approval persisted for supervised session state/i, "Approval should record a supervised-session control event.");
  assert.match(snapshot.runtimeTimeline, /Checkpoint supervised-checkpoint-/i, "Approval should record a supervised-session checkpoint summary.");
}

function assertPauseResumeStop(result: SupervisedAutonomyProofResult) {
  assert.match(result.afterPause.supervisedSession, /paused/i, "Pause should update the supervised session status.");
  assert.match(result.afterPause.runtimeTimeline, /pause_supervised_session persisted for supervised session state/i, "Pause should record a control timeline event.");
  assert.match(result.afterResume.supervisedSession, /running/i, "Resume should restore the supervised session to running.");
  assert.match(result.afterResume.runtimeTimeline, /resume_supervised_session persisted for supervised session state/i, "Resume should record a control timeline event.");
  assert.match(result.afterStop.supervisedSession, /stopped by operator/i, "Stop should mark the supervised session as stopped by operator.");
  assert.match(result.afterStop.runtimeTimeline, /stop_supervised_session persisted for supervised session state/i, "Stop should record a control timeline event.");
}

function assertRefreshPersistence(result: SupervisedAutonomyProofResult) {
  assert.equal(result.refreshed.supervisedSession, result.afterStop.supervisedSession, "Refresh should preserve the supervised-session state.");
  assert.equal(result.refreshed.runtimeTimeline, result.afterStop.runtimeTimeline, "Refresh should preserve the runtime timeline.");
}

async function main() {
  const stopResourceGuard = startResourceGuard({ label: "proof:supervised-autonomy" });
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
    let result: SupervisedAutonomyProofResult;
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
    assertApprovalTransition(result.afterApproval);
    assertPauseResumeStop(result);
    assertRefreshPersistence(result);

    process.stdout.write(JSON.stringify({
      status: "proof_passed",
      url,
      resource_usage: stopResourceGuard(),
      proof_summary: {
        live_runtime_source: "Live Runtime confirmed in the operator proof surface.",
        pre_approval_state: "A pending supervised session and its approval gate rendered before interaction.",
        approval_starts_session: "One approval started the supervised session and wrote a checkpoint.",
        control_path: "Pause, resume, and stop each persisted operator-visible control events.",
        persistence: "Refresh preserved the supervised session state, checkpoint, and timeline evidence.",
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