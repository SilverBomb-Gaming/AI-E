import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { createContinuousRuntimeProofSeedPayload } from "./continuousRuntimeProofSeed";
import { startResourceGuard } from "./resourceSafeExecution";

type DeliveryPipelineSnapshot = {
  label: string;
  stateSource: string;
  reviewPackages: string;
  deliveryPipeline: string;
  runtimeIntrospection: string;
};

type DeliveryPipelineProofResult = {
  url: string;
  before: DeliveryPipelineSnapshot;
  afterApproval: DeliveryPipelineSnapshot;
  refreshed: DeliveryPipelineSnapshot;
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

async function findAvailablePort(startPort = 3015, maxAttempts = 25): Promise<number> {
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
  const seeded = createContinuousRuntimeProofSeedPayload({ mode: "delivery-pipeline" });
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

async function runSemanticSmoke(url: string): Promise<DeliveryPipelineProofResult> {
  const smokeProcess = spawn(process.execPath, ["scripts/deliveryPipelineSemanticSmoke.js"], {
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

  return JSON.parse(stdout) as DeliveryPipelineProofResult;
}

function assertProof(result: DeliveryPipelineProofResult) {
  assert.match(result.before.stateSource, /live runtime/i, "The proof must use the live runtime source.");
  assert.match(result.before.reviewPackages, /delivery-proof-work-item/i, "The approved review package must be visible before delivery approval.");
  assert.match(result.before.deliveryPipeline, /awaiting operator approval/i, "The seeded delivery package must start at the operator approval gate.");
  assert.match(result.before.deliveryPipeline, /Rollback:/i, "Rollback notes must be present in the delivery package.");
  assert.match(result.before.deliveryPipeline, /PR title:/i, "A recommended PR title must be present in the delivery package.");
  assert.match(result.afterApproval.deliveryPipeline, /approved for commit/i, "Approving the delivery package must record the commit approval state.");
  assert.match(result.afterApproval.deliveryPipeline, /approve for commit/i, "The operator decision should remain visible after approval.");
  assert.match(result.refreshed.deliveryPipeline, /approved for commit/i, "Refreshing the operator page must preserve the approved delivery state.");
}

async function main() {
  const stopResourceGuard = startResourceGuard({ label: "proof:delivery-pipeline" });
  const port = await findAvailablePort(Number(process.env.AIE_OPERATOR_PROOF_PORT ?? 3015));
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
        delivery_seed: "The seeded review package produced a delivery package with validation evidence, rollback notes, and a recommended PR summary.",
        approval_gate: "The delivery package started in awaiting_operator_approval and required an explicit operator action.",
        operator_decision: "Approving the package recorded an approved_for_commit delivery state without bypassing the operator gate.",
        persistence: "Refreshing the live operator page preserved the approved delivery package state.",
        bounded_scope: "The proof remained within the operator delivery approval surface and did not attempt commit or push actions.",
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