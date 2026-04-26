import { createRuntimeStateStore } from "@/lib/aie/runtimeStateStore";
import { loadOperatorDashboardState } from "@/lib/aie/operatorRuntimeStateProvider";

import { OperatorDashboardClient } from "./OperatorDashboardClient";

function loadRuntimeStateStoreFromEnvironment() {
  const rawRecords = process.env.AIE_OPERATOR_RUNTIME_STATE_STORE_JSON;
  if (!rawRecords) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawRecords) as { records?: Record<string, string>; stale_after_ms?: number };
    return createRuntimeStateStore({
      records: parsed.records ?? {},
      stale_after_ms: parsed.stale_after_ms,
    });
  } catch {
    return createRuntimeStateStore({
      records: {
        [process.env.AIE_OPERATOR_RUNTIME_ID ?? "invalid-runtime"]: rawRecords,
      },
    });
  }
}

export default async function OperatorDashboardPage() {
  const initialProviderResult = await loadOperatorDashboardState({
    runtime_state_store: loadRuntimeStateStoreFromEnvironment(),
    runtime_id: process.env.AIE_OPERATOR_RUNTIME_ID ?? null,
  });
  return <OperatorDashboardClient initialProviderResult={initialProviderResult} />;
}