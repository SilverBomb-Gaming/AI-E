import type { ContinuousRuntimeLoopConfig } from "./continuousRuntimeLoop";

import type { OperatorDashboardState } from "./operatorDashboardState";

export type OperatorStateSource = "live_runtime" | "demo_seed" | "unavailable";

export type OperatorRuntimeStateProviderResult = {
  source: OperatorStateSource;
  dashboard_state: OperatorDashboardState | null;
  warnings: string[];
  loaded_at: string;
};

export type OperatorRuntimeMutationDependencies = {
  runtime_state_store?: import("./runtimeStateStore").RuntimeStateStore | null;
  runtime_id?: string | null;
  now?: string;
  start_continuous_loop?: boolean;
  continuous_loop_clock?: import("./continuousRuntimeLoop").ContinuousRuntimeLoopClock;
  continuous_loop_config?: Partial<Omit<ContinuousRuntimeLoopConfig, "runtime_id" | "started_at" | "runtime_intent" | "goal_id">>;
};