import { applyOperatorControlAction, type OperatorControlAction } from "./operatorControlSurface";
import {
  executeRuntimeMutation,
  type RuntimeMutationAuditEvent,
} from "./runtimeMutationExecutor";
import type {
  OperatorRuntimeMutationDependencies,
  OperatorRuntimeStateProviderResult,
  OperatorStateSource,
} from "./operatorRuntimeStateContract";
import { loadRuntimeState } from "./runtimeStateStore";
import {
  createSafeRuntimeActionBridgeResult,
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
  audit_event?: RuntimeMutationAuditEvent;
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
  dependencies: OperatorRuntimeMutationDependencies = {},
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

    if (bridgeResult.status !== "action_ready") {
      return {
        source: providerResult.source,
        action,
        result: "rejected",
        reason: bridgeResult.reason,
        dashboard_state: providerResult.dashboard_state,
        warnings: unique([...providerResult.warnings, ...bridgeResult.warnings]),
        runtime_intent: bridgeResult.runtime_intent,
      };
    }

    const runtimeStateStore = dependencies.runtime_state_store ?? null;
    const runtimeId = normalizeText(dependencies.runtime_id);
    if (!runtimeStateStore || !runtimeId) {
      return {
        source: providerResult.source,
        action,
        result: "accepted",
        reason: `Action accepted as runtime intent; live mutation pending implementation. Intent: ${bridgeResult.runtime_intent}`,
        dashboard_state: providerResult.dashboard_state,
        warnings: unique([...providerResult.warnings, ...bridgeResult.warnings]),
        runtime_intent: bridgeResult.runtime_intent,
      };
    }

    const currentRuntimeState = loadRuntimeState(runtimeStateStore, runtimeId);
    if (!currentRuntimeState || !providerResult.dashboard_state) {
      return {
        source: providerResult.source,
        action,
        result: "rejected",
        reason: "No persisted live runtime state is available for this operator mutation.",
        dashboard_state: providerResult.dashboard_state,
        warnings: unique([...providerResult.warnings, ...bridgeResult.warnings]),
        runtime_intent: bridgeResult.runtime_intent,
      };
    }

    const mutationResult = executeRuntimeMutation({
      runtime_intent: bridgeResult.runtime_intent,
      current_runtime_state: currentRuntimeState,
      current_dashboard_state: providerResult.dashboard_state,
      runtime_state_store: runtimeStateStore,
      runtime_id: runtimeId,
      timestamp: dependencies.now ?? providerResult.loaded_at,
      goal_id: bridgeResult.goal_id,
      source_audit_event: bridgeResult.audit_event,
      start_continuous_loop: dependencies.start_continuous_loop === true,
      continuous_loop_clock: dependencies.continuous_loop_clock,
    });

    return {
      source: providerResult.source,
      action,
      result: mutationResult.status === "mutation_rejected" ? "rejected" : "accepted",
      reason: mutationResult.reason,
      dashboard_state: mutationResult.updated_runtime_state.operator_dashboard_state ?? providerResult.dashboard_state,
      warnings: unique([...providerResult.warnings, ...bridgeResult.warnings]),
      runtime_intent: bridgeResult.runtime_intent,
      audit_event: mutationResult.audit_event,
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