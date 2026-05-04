import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderOperatorView, renderOperatorViewSummary, type OperatorViewState } from "../lib/aie/operatorView";

type ShowOperatorViewOptions = {
  json: boolean;
};

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

function parseArgs(argv: string[]): ShowOperatorViewOptions {
  const options: ShowOperatorViewOptions = {
    json: false,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    }
  }

  return options;
}

function buildDemoOperatorState(): OperatorViewState {
  return {
    nodes: [
      {
        node_id: "node-a",
        hostname: "validator-a",
        platform: "linux",
        status: "available",
        capabilities: ["inspection", "validation-check", "repo-scan"],
        last_seen_at: "2026-05-04T18:00:00.000Z",
      },
    ],
    healthSnapshots: [
      {
        node_id: "node-a",
        checked_at: "2026-05-04T18:01:00.000Z",
        status: "healthy",
        latency_ms: 12,
        uptime_seconds: 86400,
        load_average: 0.32,
        warnings: [],
        execution_ready: false,
      },
    ],
    readinessResults: [
      {
        node_id: "node-a",
        evaluated_at: "2026-05-04T18:02:00.000Z",
        readiness_status: "ready_candidate",
        reasons: [],
        required_capabilities: ["inspection"],
        missing_capabilities: [],
        health_status: "healthy",
        execution_ready: false,
      },
    ],
    routingResults: [
      {
        simulated: true,
        task_id: "task-x",
        required_capabilities: ["inspection"],
        selected_node_id: "node-a",
        candidate_nodes: ["node-a"],
        blocked_nodes: [],
        routing_allowed: false,
      },
    ],
    dispatchResults: [
      {
        dispatched: true,
        node_id: "node-a",
        task_id: "task-x",
        reason: "dispatched intent only",
      },
    ],
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(argv);
    const state = buildDemoOperatorState();
    const view = renderOperatorView(state);

    if (options.json) {
      console.log(JSON.stringify(view, null, 2));
      return 0;
    }

    console.log(renderOperatorViewSummary(view));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Operator view display failed: ${message}`);
    return 1;
  }
}

if (isDirectExecution()) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}