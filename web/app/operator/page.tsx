import { getOperatorRuntimeId, getOperatorRuntimeStateStore } from "@/lib/aie/operatorRuntimeServerStore";
import { loadOperatorDashboardState } from "@/lib/aie/operatorRuntimeStateProvider";

import { OperatorDashboardClient } from "./OperatorDashboardClient";

export default async function OperatorDashboardPage() {
  const initialProviderResult = await loadOperatorDashboardState({
    runtime_state_store: getOperatorRuntimeStateStore(),
    runtime_id: getOperatorRuntimeId(),
  });
  return <OperatorDashboardClient initialProviderResult={initialProviderResult} />;
}