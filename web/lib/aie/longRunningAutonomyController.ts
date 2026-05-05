import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  runPostPlaytestFeatureChain,
  type PostPlaytestFeatureChainControllerInput,
  type PostPlaytestFeatureChainControllerResult,
} from "./postPlaytestFeatureChainController";

export type LongRunningAutonomyControllerStatus =
  | "cycle_completed"
  | "session_completed"
  | "session_blocked"
  | "budget_exhausted"
  | "operator_review_required"
  | "safety_stop";

export type LongRunningAutonomyBridgeProbeResult = {
  bridge_status: "bridge_ready" | "bridge_unavailable";
  reason?: string;
};

export type LongRunningAutonomyCycleContext = {
  cycle_index: number;
  max_cycles: number;
  max_features_per_cycle: number;
  max_iterations_per_feature: number;
  session_features_completed: string[];
  previous_cycle: PostPlaytestFeatureChainControllerResult | null;
};

export type LongRunningAutonomyCheckpoint = {
  session_id: string;
  cycle: number;
  status: PostPlaytestFeatureChainControllerResult["status"];
  features_completed: string[];
  features_attempted: string[];
  stop_reason: string;
  created_at: string;
};

export type LongRunningAutonomyControllerInput = {
  session_id: string;
  operator_approval: boolean;
  max_cycles: number;
  max_features_per_cycle: number;
  max_iterations_per_feature: number;
  feature_pool: string[];
  checkpoint_directory: string;
  probe_bridge?: (
    context: Pick<LongRunningAutonomyCycleContext, "cycle_index" | "max_cycles">,
  ) => Promise<LongRunningAutonomyBridgeProbeResult> | LongRunningAutonomyBridgeProbeResult;
  create_cycle: (
    context: LongRunningAutonomyCycleContext,
  ) => Promise<Omit<PostPlaytestFeatureChainControllerInput, "operator_approval" | "max_features" | "max_iterations_per_feature"> | null>
    | Omit<PostPlaytestFeatureChainControllerInput, "operator_approval" | "max_features" | "max_iterations_per_feature"> | null;
};

export type LongRunningAutonomyControllerResult = {
  status: LongRunningAutonomyControllerStatus;
  cycles_completed: number;
  max_cycles: number;
  features_completed: string[];
  decisions_made: string[];
  stop_reason: string;
  checkpoint_path?: string;
  confidence: "low" | "medium" | "high";
};

const HARD_MAX_CYCLES = 2;
const HARD_MAX_FEATURES_PER_CYCLE = 2;
const HARD_MAX_ITERATIONS_PER_FEATURE = 2;

function clampBoundedCount(value: number, hardMax: number): number {
  if (!Number.isFinite(value)) {
    return hardMax;
  }

  return Math.max(1, Math.min(hardMax, Math.trunc(value)));
}

function mergeConfidence(
  current: "low" | "medium" | "high",
  next: "low" | "medium" | "high",
): "low" | "medium" | "high" {
  if (current === "low" || next === "low") {
    return "low";
  }

  if (current === "medium" || next === "medium") {
    return "medium";
  }

  return "high";
}

function uniqueOrdered(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function createResult(
  status: LongRunningAutonomyControllerStatus,
  stopReason: string,
  overrides: Partial<LongRunningAutonomyControllerResult> = {},
): LongRunningAutonomyControllerResult {
  return {
    status,
    cycles_completed: overrides.cycles_completed ?? 0,
    max_cycles: overrides.max_cycles ?? HARD_MAX_CYCLES,
    features_completed: overrides.features_completed ?? [],
    decisions_made: overrides.decisions_made ?? [],
    stop_reason: stopReason,
    checkpoint_path: overrides.checkpoint_path,
    confidence: overrides.confidence ?? "medium",
  };
}

function buildCheckpointPath(directory: string, sessionId: string): string {
  return path.join(directory, `${sessionId}.long-running-checkpoint.json`);
}

async function writeCheckpoint(
  checkpointDirectory: string,
  sessionId: string,
  checkpoint: LongRunningAutonomyCheckpoint,
): Promise<string> {
  const checkpointPath = buildCheckpointPath(checkpointDirectory, sessionId);
  await mkdir(path.dirname(checkpointPath), { recursive: true });
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf-8");
  return checkpointPath;
}

function mapCycleStopStatus(
  result: PostPlaytestFeatureChainControllerResult,
): Pick<LongRunningAutonomyControllerResult, "status" | "stop_reason"> {
  switch (result.status) {
    case "operator_review_required":
      return {
        status: "operator_review_required",
        stop_reason: result.stop_reason,
      };
    case "chain_retry_limit_reached":
      return {
        status: "budget_exhausted",
        stop_reason: result.stop_reason,
      };
    case "chain_blocked":
      return /rollback|bridge unavailable|repeated failure/i.test(result.stop_reason)
        ? {
            status: "safety_stop",
            stop_reason: result.stop_reason,
          }
        : {
            status: "session_blocked",
            stop_reason: result.stop_reason,
          };
    case "chain_completed":
    case "chain_stopped_success":
      return {
        status: "session_completed",
        stop_reason: result.stop_reason,
      };
    default:
      return {
        status: "session_blocked",
        stop_reason: result.stop_reason,
      };
  }
}

export async function runLongRunningAutonomySession(
  input: LongRunningAutonomyControllerInput,
): Promise<LongRunningAutonomyControllerResult> {
  const maxCycles = clampBoundedCount(input.max_cycles, HARD_MAX_CYCLES);
  const maxFeaturesPerCycle = clampBoundedCount(input.max_features_per_cycle, HARD_MAX_FEATURES_PER_CYCLE);
  const maxIterationsPerFeature = clampBoundedCount(
    input.max_iterations_per_feature,
    HARD_MAX_ITERATIONS_PER_FEATURE,
  );
  const boundedPool = uniqueOrdered(input.feature_pool);
  const sessionFeaturesCompleted: string[] = [];
  const decisionsMade: string[] = [];
  let cyclesCompleted = 0;
  let checkpointPath: string | undefined;
  let confidence: "low" | "medium" | "high" = "high";
  let previousCycle: PostPlaytestFeatureChainControllerResult | null = null;

  if (!input.operator_approval) {
    return createResult(
      "operator_review_required",
      "The supervised long-running autonomy session requires explicit operator approval before the first cycle can begin.",
      {
        max_cycles: maxCycles,
        confidence: "high",
      },
    );
  }

  if (boundedPool.length === 0) {
    return createResult(
      "session_blocked",
      "The supervised long-running autonomy session requires an explicit feature pool and cannot auto-discover new work.",
      {
        max_cycles: maxCycles,
        confidence: "high",
      },
    );
  }

  for (let cycleIndex = 0; cycleIndex < maxCycles; cycleIndex += 1) {
    if (input.probe_bridge) {
      const bridgeResult = await input.probe_bridge({
        cycle_index: cycleIndex,
        max_cycles: maxCycles,
      });

      if (bridgeResult.bridge_status === "bridge_unavailable") {
        decisionsMade.push(`cycle_${cycleIndex + 1}:bridge_unavailable`);
        return createResult(
          cyclesCompleted > 0 ? "safety_stop" : "session_blocked",
          bridgeResult.reason ?? "The reviewed Unity bridge is unavailable, so the supervised session stopped safely before another cycle.",
          {
            cycles_completed: cyclesCompleted,
            max_cycles: maxCycles,
            features_completed: sessionFeaturesCompleted,
            decisions_made: decisionsMade,
            checkpoint_path: checkpointPath,
            confidence: mergeConfidence(confidence, "low"),
          },
        );
      }
    }

    const cycleContext: LongRunningAutonomyCycleContext = {
      cycle_index: cycleIndex,
      max_cycles: maxCycles,
      max_features_per_cycle: maxFeaturesPerCycle,
      max_iterations_per_feature: maxIterationsPerFeature,
      session_features_completed: sessionFeaturesCompleted.slice(),
      previous_cycle: previousCycle,
    };
    const cycleInput = await input.create_cycle(cycleContext);

    if (!cycleInput) {
      decisionsMade.push(`cycle_${cycleIndex + 1}:no_cycle_materialized`);
      return createResult(
        cyclesCompleted > 0 ? "cycle_completed" : "session_blocked",
        cyclesCompleted > 0
          ? "The supervised long-running autonomy session stopped after a completed cycle because no further reviewed cycle package was available."
          : "The supervised long-running autonomy session could not materialize a reviewed cycle package.",
        {
          cycles_completed: cyclesCompleted,
          max_cycles: maxCycles,
          features_completed: sessionFeaturesCompleted,
          decisions_made: decisionsMade,
          checkpoint_path: checkpointPath,
          confidence,
        },
      );
    }

    if (uniqueOrdered(cycleInput.feature_pool).length === 0) {
      decisionsMade.push(`cycle_${cycleIndex + 1}:no_feature_available`);
      return createResult(
        cyclesCompleted > 0 ? "session_completed" : "session_blocked",
        cyclesCompleted > 0
          ? "The supervised long-running autonomy session stopped safely because no reviewed feature remained available for the next cycle."
          : "The supervised long-running autonomy session could not begin because no reviewed feature remained available in the explicit pool.",
        {
          cycles_completed: cyclesCompleted,
          max_cycles: maxCycles,
          features_completed: uniqueOrdered(sessionFeaturesCompleted),
          decisions_made: decisionsMade,
          checkpoint_path: checkpointPath,
          confidence,
        },
      );
    }

    const cycleResult = await runPostPlaytestFeatureChain({
      ...cycleInput,
      operator_approval: true,
      max_features: maxFeaturesPerCycle,
      max_iterations_per_feature: maxIterationsPerFeature,
    });
    previousCycle = cycleResult;
    cyclesCompleted += 1;
    confidence = mergeConfidence(confidence, cycleResult.confidence);
    sessionFeaturesCompleted.push(...cycleResult.features_completed);
    decisionsMade.push(`cycle_${cycleIndex + 1}:${cycleResult.status}`);

    checkpointPath = await writeCheckpoint(input.checkpoint_directory, input.session_id, {
      session_id: input.session_id,
      cycle: cycleIndex + 1,
      status: cycleResult.status,
      features_completed: uniqueOrdered(sessionFeaturesCompleted),
      features_attempted: cycleResult.features_attempted,
      stop_reason: cycleResult.stop_reason,
      created_at: new Date().toISOString(),
    });

    if (cycleResult.status === "chain_completed" || cycleResult.status === "chain_stopped_success") {
      if (cycleIndex + 1 >= maxCycles) {
        return createResult(
          "budget_exhausted",
          `The supervised long-running autonomy session reached its hard cycle budget of ${maxCycles} after writing the latest checkpoint.`,
          {
            cycles_completed: cyclesCompleted,
            max_cycles: maxCycles,
            features_completed: uniqueOrdered(sessionFeaturesCompleted),
            decisions_made: decisionsMade,
            checkpoint_path: checkpointPath,
            confidence,
          },
        );
      }

      continue;
    }

    const mapped = mapCycleStopStatus(cycleResult);
    return createResult(mapped.status, mapped.stop_reason, {
      cycles_completed: cyclesCompleted,
      max_cycles: maxCycles,
      features_completed: uniqueOrdered(sessionFeaturesCompleted),
      decisions_made: decisionsMade,
      checkpoint_path: checkpointPath,
      confidence,
    });
  }

  return createResult(
    "budget_exhausted",
    `The supervised long-running autonomy session reached its hard cycle budget of ${maxCycles}.`,
    {
      cycles_completed: cyclesCompleted,
      max_cycles: maxCycles,
      features_completed: uniqueOrdered(sessionFeaturesCompleted),
      decisions_made: decisionsMade,
      checkpoint_path: checkpointPath,
      confidence,
    },
  );
}