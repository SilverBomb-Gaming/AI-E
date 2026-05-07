import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { createContinuousRuntimeProofSeedPayload } from "./continuousRuntimeProofSeed";
import { startResourceGuard } from "./resourceSafeExecution";

type StrategyEngineSnapshot = {
  label: string;
  stateSource: string;
  strategySection: string;
  runtimeIntrospection: string;
  strategySummary: string | null;
};

type StrategyEngineProofResult = {
  url: string;
  before: StrategyEngineSnapshot;
  afterApprove: StrategyEngineSnapshot;
  afterActivate: StrategyEngineSnapshot;
  afterDecompose: StrategyEngineSnapshot;
  afterSummary: StrategyEngineSnapshot;
  refreshed: StrategyEngineSnapshot;
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

async function findAvailablePort(startPort = 3019, maxAttempts = 25): Promise<number> {
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
  const seeded = createContinuousRuntimeProofSeedPayload({ mode: "strategy-engine" });
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

async function runSemanticSmoke(url: string): Promise<StrategyEngineProofResult> {
  const smokeProcess = spawn(process.execPath, ["scripts/strategyEngineSemanticSmoke.js"], {
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

  return JSON.parse(stdout) as StrategyEngineProofResult;
}

function assertProof(result: StrategyEngineProofResult) {
  assert.match(result.before.stateSource, /live runtime/i, "The proof must use the live runtime source.");
  assert.match(result.before.strategySection, /Proposed Strategic Goals/i, "The strategy portfolio must render summary metrics.");
  assert.match(result.before.strategySection, /Top Portfolio Score/i, "The strategy portfolio must render deterministic ranking metrics.");
  assert.match(result.before.strategySection, /Recommended next action/i, "Each strategy row must surface a recommended action.");
  assert.match(result.afterApprove.runtimeIntrospection, /approve_strategy_goal persisted for strategy portfolio state/i, "Strategy approval must persist through the live strategy mutation path.");
  assert.match(result.afterActivate.runtimeIntrospection, /activate_strategy_goal persisted for strategy portfolio state/i, "Strategy activation must persist through the live strategy mutation path.");
  assert.match(result.afterDecompose.runtimeIntrospection, /decompose_strategy_goal persisted for strategy portfolio state/i, "Strategy decomposition must persist through the live strategy mutation path.");
  assert.ok(result.afterSummary.strategySummary, "Requesting a strategy summary must produce a persisted summary package.");
  assert.ok(result.refreshed.strategySummary, "The strategy summary package must persist after refresh.");
  assert.match(result.refreshed.runtimeIntrospection, /request_strategy_summary persisted for strategy portfolio state/i, "The proof must end with a persisted strategy mutation.");
  assert.match(result.refreshed.runtimeIntrospection, /LATEST SAFETY GATE DECISION\s+not triggered/i, "The strategy engine proof must not trigger hidden execution.");
}

async function main() {
  const stopResourceGuard = startResourceGuard({ label: "proof:strategy-engine" });
  const port = await findAvailablePort(Number(process.env.AIE_OPERATOR_PROOF_PORT ?? 3019));
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
        live_runtime_source: "The operator dashboard rendered Strategy Portfolio from the seeded live runtime store.",
        portfolio_ranking: "The panel surfaced deterministic ranking, recommended next actions, and linked work context from live operator state.",
        safe_strategy_actions: "Strategic approval, activation, decomposition, and summary generation all mutated persisted live runtime state through the safe action path.",
        advisory_decomposition: "Decomposition produced bounded proposed work items only and did not start hidden execution.",
        persistence: "Strategy decisions, decompositions, and the summary package survived refresh.",
        bounded_scope: "The proof stayed within operator-gated strategic controls with no automatic execution or code mutation.",
      },
      snapshots: result,
    }, null, 2));
  } finally {
    stopResourceGuard();
    await stopServerProcess(serverProcess);
  }
}

void main();