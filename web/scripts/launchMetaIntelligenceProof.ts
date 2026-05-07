import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { createContinuousRuntimeProofSeedPayload } from "./continuousRuntimeProofSeed";
import { startResourceGuard } from "./resourceSafeExecution";

type MetaIntelligenceSnapshot = {
  label: string;
  stateSource: string;
  metaSection: string;
  runtimeIntrospection: string;
  metaSummary: string | null;
};

type MetaIntelligenceProofResult = {
  url: string;
  before: MetaIntelligenceSnapshot;
  afterAcknowledge: MetaIntelligenceSnapshot;
  afterApprove: MetaIntelligenceSnapshot;
  afterSummary: MetaIntelligenceSnapshot;
  refreshed: MetaIntelligenceSnapshot;
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

async function findAvailablePort(startPort = 3018, maxAttempts = 25): Promise<number> {
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
  const seeded = createContinuousRuntimeProofSeedPayload({ mode: "meta-intelligence" });
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

async function runSemanticSmoke(url: string): Promise<MetaIntelligenceProofResult> {
  const smokeProcess = spawn(process.execPath, ["scripts/metaIntelligenceSemanticSmoke.js"], {
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

  return JSON.parse(stdout) as MetaIntelligenceProofResult;
}

function assertProof(result: MetaIntelligenceProofResult) {
  assert.match(result.before.stateSource, /live runtime/i, "The proof must use the live runtime source.");
  assert.match(result.before.metaSection, /Observed Sessions/i, "The meta-intelligence panel must render summary metrics.");
  assert.match(result.before.metaSection, /Detected Patterns/i, "The meta-intelligence panel must render detected patterns.");
  assert.match(result.before.metaSection, /Policy Recommendations/i, "The meta-intelligence panel must render advisory policy recommendations.");
  assert.match(result.before.metaSection, /Persisted Policy State/i, "The meta-intelligence panel must render persisted policy state.");
  assert.match(result.afterAcknowledge.runtimeIntrospection, /acknowledge_pattern persisted for meta intelligence state/i, "Pattern acknowledgement must persist through the live meta-intelligence mutation path.");
  assert.match(result.afterApprove.runtimeIntrospection, /approve_policy_recommendation persisted for meta intelligence state/i, "Recommendation approval must persist through the live meta-intelligence mutation path.");
  assert.ok(result.afterSummary.metaSummary, "Requesting a meta summary must produce a persisted summary package.");
  assert.ok(result.refreshed.metaSummary, "The meta summary package must persist after refresh.");
  assert.match(result.refreshed.runtimeIntrospection, /request_meta_summary persisted for meta intelligence state/i, "The proof must end with a persisted meta-intelligence mutation.");
  assert.match(result.refreshed.runtimeIntrospection, /LATEST SAFETY GATE DECISION\s+not triggered/i, "The meta-intelligence proof must not trigger hidden execution.");
}

async function main() {
  const stopResourceGuard = startResourceGuard({ label: "proof:meta-intelligence" });
  const port = await findAvailablePort(Number(process.env.AIE_OPERATOR_PROOF_PORT ?? 3018));
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
        live_runtime_source: "The operator dashboard rendered Meta-Intelligence from the seeded live runtime store.",
        recurring_patterns: "The panel surfaced deterministic recurring patterns, bounded advisory recommendations, and persisted policy state from the same live operator snapshot.",
        safe_meta_actions: "Pattern acknowledgement, recommendation approval, and summary generation all mutated persisted live runtime state through the safe action path.",
        summary_package: "Requesting a meta summary generated a persisted operator-readable summary package from live state.",
        persistence: "Approved recommendations, operator decision history, and the summary package survived refresh.",
        bounded_scope: "The proof stayed within advisory policy state and operator-gated controls with no code mutation or hidden execution.",
      },
      snapshots: result,
    }, null, 2));
  } finally {
    stopResourceGuard();
    await stopServerProcess(serverProcess);
  }
}

void main();
