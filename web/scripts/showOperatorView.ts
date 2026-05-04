import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inspectGameProject, renderGameProjectSummary } from "../lib/aie/gameProjectInspector";
import { generateGameTask, renderGameTask } from "../lib/aie/gameTaskGenerator";
import { renderOperatorView, renderOperatorViewSummary, type OperatorViewState } from "../lib/aie/operatorView";
import type { OperatorViewSnapshot } from "../lib/aie/operatorView.types";
import { inspectUnityPlaytestRecovery, renderUnityPlaytestRecovery } from "../lib/aie/unityPlaytestRecovery";

type ShowOperatorViewOptions = {
  json: boolean;
  interactive: boolean;
  projectPath?: string;
  gameTaskPath?: string;
  unityRecoveryPath?: string;
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
    interactive: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--interactive") {
      options.interactive = true;
      continue;
    }

    if (arg.startsWith("--project=")) {
      options.projectPath = arg.slice("--project=".length).trim() || undefined;
      continue;
    }

    if (arg === "--project") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --project");
      }
      options.projectPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--game-task=")) {
      options.gameTaskPath = arg.slice("--game-task=".length).trim() || undefined;
      continue;
    }

    if (arg === "--game-task") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --game-task");
      }
      options.gameTaskPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--unity-recovery=")) {
      options.unityRecoveryPath = arg.slice("--unity-recovery=".length).trim() || undefined;
      continue;
    }

    if (arg === "--unity-recovery") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --unity-recovery");
      }
      options.unityRecoveryPath = value.trim();
      index += 1;
      continue;
    }
  }

  return options;
}

function renderNodesView(view: OperatorViewSnapshot): string {
  const lines = ["Nodes:"];

  if (view.nodes.length === 0) {
    lines.push("- none");
    return lines.join("\n");
  }

  for (const node of view.nodes) {
    lines.push(`- ${node.id} [${node.status}] readiness: ${node.readiness} lastHealthCheck: ${node.lastHealthCheck}`);
  }

  return lines.join("\n");
}

function renderRoutingView(view: OperatorViewSnapshot): string {
  const lines = [
    "Routing:",
    `- lastSimulation: ${view.routing.lastSimulation ?? "none"}`,
    `- selectedNode: ${view.routing.selectedNode ?? "none"}`,
  ];

  if (view.routing.candidates.length === 0) {
    lines.push("- candidates: none");
    return lines.join("\n");
  }

  for (const candidate of view.routing.candidates) {
    lines.push(`- candidate ${candidate.nodeId} score: ${candidate.score}`);
  }

  return lines.join("\n");
}

function renderDispatchView(view: OperatorViewSnapshot): string {
  const lines = ["Dispatch Logs:"];

  if (view.dispatch.recent.length === 0) {
    lines.push("- none");
    return lines.join("\n");
  }

  for (const entry of view.dispatch.recent) {
    lines.push(`- ${entry.intent} -> ${entry.targetNode} ${entry.result} at ${entry.timestamp}`);
  }

  return lines.join("\n");
}

function renderMenu(): string {
  return [
    "Operator View",
    "",
    "1. System Status",
    "2. Nodes",
    "3. Routing",
    "4. Dispatch Logs",
    "5. Exit",
  ].join("\n");
}

async function runInteractiveOperatorView(view: OperatorViewSnapshot): Promise<number> {
  const readline = createInterface({ input, output });

  try {
    let running = true;

    while (running) {
      console.log(renderMenu());
      const selection = (await readline.question("Select an option: ")).trim();

      switch (selection) {
        case "1":
          console.log(renderOperatorViewSummary(view));
          await readline.question("Press Enter to return to menu.");
          break;
        case "2":
          console.log(renderNodesView(view));
          await readline.question("Press Enter to return to menu.");
          break;
        case "3":
          console.log(renderRoutingView(view));
          await readline.question("Press Enter to return to menu.");
          break;
        case "4":
          console.log(renderDispatchView(view));
          await readline.question("Press Enter to return to menu.");
          break;
        case "5":
          running = false;
          break;
        default:
          console.log("Invalid selection. Choose 1-5.");
          await readline.question("Press Enter to return to menu.");
          break;
      }
    }

    return 0;
  } finally {
    readline.close();
  }
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

    if (options.json && options.interactive) {
      throw new Error("Use either --json or --interactive, not both.");
    }

    if (options.projectPath && options.interactive) {
      throw new Error("Use either --project or --interactive, not both.");
    }

    if (options.gameTaskPath && options.interactive) {
      throw new Error("Use either --game-task or --interactive, not both.");
    }

    if (options.gameTaskPath && options.projectPath) {
      throw new Error("Use either --game-task or --project, not both.");
    }

    if (options.unityRecoveryPath && options.interactive) {
      throw new Error("Use either --unity-recovery or --interactive, not both.");
    }

    if (options.unityRecoveryPath && options.projectPath) {
      throw new Error("Use either --unity-recovery or --project, not both.");
    }

    if (options.unityRecoveryPath && options.gameTaskPath) {
      throw new Error("Use either --unity-recovery or --game-task, not both.");
    }

    if (options.unityRecoveryPath) {
      const snapshot = await inspectUnityPlaytestRecovery(options.unityRecoveryPath);

      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return 0;
      }

      console.log(renderUnityPlaytestRecovery(snapshot, resolve(fileURLToPath(import.meta.url), "..", "..", "..")));
      return 0;
    }

    if (options.gameTaskPath) {
      const snapshot = await inspectGameProject(options.gameTaskPath);
      const task = generateGameTask(snapshot);

      if (options.json) {
        console.log(JSON.stringify(task, null, 2));
        return 0;
      }

      console.log(renderGameTask(task));
      return 0;
    }

    if (options.projectPath) {
      const snapshot = await inspectGameProject(options.projectPath);

      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return 0;
      }

      console.log(renderGameProjectSummary(snapshot));
      return 0;
    }

    const state = buildDemoOperatorState();
    const view = renderOperatorView(state);

    if (options.json) {
      console.log(JSON.stringify(view, null, 2));
      return 0;
    }

    if (options.interactive) {
      return runInteractiveOperatorView(view);
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