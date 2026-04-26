import { applyOperatorControlAction, type OperatorControlAction } from "./operatorControlSurface";
import type { OperatorRuntimeStateProviderResult, OperatorStateSource } from "./operatorRuntimeStateContract";
import {
  createSafeRuntimeActionBridgeResult,
  type SafeRuntimeActionAuditEvent,
  type SafeRuntimeIntent,
} from "./safeRuntimeActionBridge";

export type OperatorRuntimeActionResult = {
  source: OperatorStateSource;
  action: OperatorControlAction;
  result: "accepted" | "rejected";
  reason: string;
  dashboard_state: OperatorRuntimeStateProviderResult["dashboard_state"];
  warnings: string[];
  runtime_intent?: SafeRuntimeIntent;
  audit_event?: SafeRuntimeActionAuditEvent;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

export function applyOperatorActionToProviderState(
  providerResult: OperatorRuntimeStateProviderResult,
  action: OperatorControlAction,
): OperatorRuntimeActionResult {
  if (!providerResult.dashboard_state) {
    return {
      source: providerResult.source,
      action,
      result: "rejected",
      reason: "No dashboard state is available for this operator action.",
      dashboard_state: providerResult.dashboard_state,
      warnings: providerResult.warnings,
    };
  }

  if (providerResult.source === "live_runtime") {
    const bridgeResult = createSafeRuntimeActionBridgeResult(providerResult, action);
    return {
      source: providerResult.source,
      action,
      result: bridgeResult.status === "action_ready" ? "accepted" : "rejected",
      reason: bridgeResult.status === "action_ready"
        ? `Action accepted as runtime intent; live mutation pending implementation. Intent: ${bridgeResult.runtime_intent}`
        : bridgeResult.reason,
      dashboard_state: providerResult.dashboard_state,
      warnings: unique([...providerResult.warnings, ...bridgeResult.warnings]),
      runtime_intent: bridgeResult.runtime_intent,
      audit_event: bridgeResult.audit_event,
    };
  }

  const controlResult = applyOperatorControlAction(providerResult.dashboard_state, action);
  return {
    source: providerResult.source,
    action,
    result: controlResult.changed ? "accepted" : "rejected",
    reason: controlResult.message,
    dashboard_state: controlResult.state,
    warnings: providerResult.warnings,
  };
}