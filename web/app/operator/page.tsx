import { createOperatorDashboardDemoState } from "@/lib/aie/operatorDashboardDemoState";

import { OperatorDashboardClient } from "./OperatorDashboardClient";

export default function OperatorDashboardPage() {
  const initialState = createOperatorDashboardDemoState();
  return <OperatorDashboardClient initialState={initialState} />;
}