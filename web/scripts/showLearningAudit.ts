import { resolve } from "node:path";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { queryDecisionRecords } from "../lib/aie/decisionTrace";
import { buildPassiveLearningAudit, recordPassiveLearningAudit, renderPassiveLearningAudit } from "../lib/aie/passiveLearningAudit";
import { rankPlans, type NodePlanRanking } from "../lib/aie/planRanking";
import { computeLearningSignals } from "../lib/aie/passiveLearningSignals";
import { simulateRankingAdjustments } from "../lib/aie/passiveLearningSimulation";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");
const DEFAULT_OUTPUT_DIRECTORY = path.join(REPO_ROOT, "data", "decision_records");

type ShowLearningAuditOptions = {
  outputDirectory: string;
  json: boolean;
  write: boolean;
  rankingsFile?: string;
};

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

function parseArgs(argv: string[]): ShowLearningAuditOptions {
  const options: ShowLearningAuditOptions = {
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    json: false,
    write: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--write") {
      options.write = true;
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

    if (arg.startsWith("--rankings-file=")) {
      options.rankingsFile = arg.slice("--rankings-file=".length).trim() || undefined;
      continue;
    }

    if (arg === "--rankings-file") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --rankings-file");
      }
      options.rankingsFile = value.trim();
      index += 1;
    }
  }

  return options;
}

async function loadRankings(rankingsFile: string | undefined): Promise<NodePlanRanking[]> {
  if (rankingsFile) {
    const module = await import(pathToFileURL(path.resolve(WEB_ROOT, rankingsFile)).href);
    const rankings = module.default ?? module.rankings;
    if (!Array.isArray(rankings)) {
      throw new Error("Rankings file must export an array as default or named 'rankings'.");
    }
    return rankings as NodePlanRanking[];
  }

  return rankPlans([
    {
      plan_id: "plan-a",
      label: "Alternative A",
      source: "alternative",
      command: "python diagnostics_smoke.py",
      steps: [
        "run python validate_runtime.py in test mode first",
        "ensure the recovery plan is ready and reviewed",
      ],
    },
    {
      plan_id: "plan-b",
      label: "Alternative B",
      source: "alternative",
      command: "python validate_runtime.py",
      steps: [
        "review the current bounded plan",
      ],
    },
  ], [
    {
      insight_id: "audit-demo-risk-1",
      created_at: "2026-05-03T15:30:00.000Z",
      category: "risk",
      description: "Rollback frequency and failure rate remain high for the current path.",
      supporting_metrics: {
        failure_rate: 0.82,
        rollback_required_rate: 0.71,
        success_rate: 0.18,
      },
      confidence: 0.94,
      severity: "critical",
      suggestion: "Use a safer reviewed alternative.",
    },
  ], "high");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(argv);
    const records = await queryDecisionRecords({ outputDirectory: options.outputDirectory });
    const signals = computeLearningSignals(records);
    const rankings = await loadRankings(options.rankingsFile);
    const simulations = simulateRankingAdjustments(signals, rankings);
    const audit = buildPassiveLearningAudit({
      signals,
      simulations,
      source_decision_record_count: records.length,
    });

    if (options.write) {
      await recordPassiveLearningAudit(audit);
    }

    if (options.json) {
      console.log(JSON.stringify(audit, null, 2));
      return 0;
    }

    console.log(renderPassiveLearningAudit(audit));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Learning audit display failed: ${message}`);
    return 1;
  }
}

if (isDirectExecution()) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}