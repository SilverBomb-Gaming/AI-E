import type { OperatorDashboardState } from "./operatorDashboardState";

export type OperatorStateSource = "live_runtime" | "demo_seed" | "unavailable";

export type OperatorRuntimeStateProviderResult = {
  source: OperatorStateSource;
  dashboard_state: OperatorDashboardState | null;
  warnings: string[];
  loaded_at: string;
};