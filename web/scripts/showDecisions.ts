import path, { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  queryDecisionRecords,
  renderDecisionReplay,
  type DecisionRecord,
  type DecisionRecordQueryFilters,
} from "../lib/aie/decisionTrace";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");
const DEFAULT_OUTPUT_DIRECTORY = path.join(REPO_ROOT, "data", "decision_records");

type ShowDecisionsOptions = DecisionRecordQueryFilters & {
  json: boolean;
};

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

function parseArgs(argv: string[]): ShowDecisionsOptions {
  const options: ShowDecisionsOptions = {
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg.startsWith("--output-dir=")) {
      options.outputDirectory = arg.slice("--output-dir=".length).trim() || DEFAULT_OUTPUT_DIRECTORY;
      continue;
    }

    if (arg === "--output-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --output-dir");
      }
      options.outputDirectory = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--selected-plan-id=")) {
      options.selected_plan_id = arg.slice("--selected-plan-id=".length).trim() || undefined;
      continue;
    }

    if (arg === "--selected-plan-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --selected-plan-id");
      }
      options.selected_plan_id = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--available-plan-id=")) {
      options.available_plan_id = arg.slice("--available-plan-id=".length).trim() || undefined;
      continue;
    }

    if (arg === "--available-plan-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --available-plan-id");
      }
      options.available_plan_id = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--acknowledged=")) {
      const value = arg.slice("--acknowledged=".length).trim().toLowerCase();
      if (!["true", "false"].includes(value)) {
        throw new Error("--acknowledged must be true or false");
      }
      options.acknowledged = value === "true";
      continue;
    }

    if (arg === "--acknowledged") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --acknowledged");
      }
      const normalized = value.trim().toLowerCase();
      if (!["true", "false"].includes(normalized)) {
        throw new Error("--acknowledged must be true or false");
      }
      options.acknowledged = normalized === "true";
      index += 1;
      continue;
    }

    if (arg.startsWith("--minimum-severity=")) {
      const value = arg.slice("--minimum-severity=".length).trim().toLowerCase();
      if (!["low", "medium", "high", "critical"].includes(value)) {
        throw new Error("--minimum-severity must be one of low, medium, high, critical");
      }
      options.minimum_severity = value as NonNullable<DecisionRecordQueryFilters["minimum_severity"]>;
      continue;
    }

    if (arg === "--minimum-severity") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --minimum-severity");
      }
      const normalized = value.trim().toLowerCase();
      if (!["low", "medium", "high", "critical"].includes(normalized)) {
        throw new Error("--minimum-severity must be one of low, medium, high, critical");
      }
      options.minimum_severity = normalized as NonNullable<DecisionRecordQueryFilters["minimum_severity"]>;
      index += 1;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length).trim());
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("--limit must be a non-negative integer");
      }
      options.limit = value;
      continue;
    }

    if (arg === "--limit") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --limit");
      }
      const normalized = Number(value.trim());
      if (!Number.isInteger(normalized) || normalized < 0) {
        throw new Error("--limit must be a non-negative integer");
      }
      options.limit = normalized;
      index += 1;
    }
  }

  return options;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(argv);
    const records = await queryDecisionRecords(options);

    if (options.json) {
      const payload: {
        output_directory: string;
        decision_count: number;
        records: DecisionRecord[];
      } = {
        output_directory: options.outputDirectory ?? DEFAULT_OUTPUT_DIRECTORY,
        decision_count: records.length,
        records,
      };
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    if (records.length === 0) {
      console.log("No decision records found.");
      return 0;
    }

    console.log(records.map((record) => renderDecisionReplay(record)).join("\n\n---\n\n"));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Decision replay display failed: ${message}`);
    return 1;
  }
}

if (isDirectExecution()) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
