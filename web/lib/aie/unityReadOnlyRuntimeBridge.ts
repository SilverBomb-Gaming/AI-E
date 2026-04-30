export type UnityReadOnlyBridgeProbeInput = {
  request_id: string;
  requested_at: string;
  scene_name_hint: string | null;
};

export type UnityReadOnlyBridgeObservation = {
  bridge_status: "bridge_ready";
  scene_validation_status: "checked_clean" | "checked_with_findings" | "unknown";
  missing_script_count: number | null;
  console_error_count: number | null;
  object_count: number | null;
  checked_scene_name: string | null;
  evidence_timestamp: string;
  summary: string;
  recommended_next_operator_action: string;
};

export type UnityReadOnlyBridgeUnavailable = {
  bridge_status: "bridge_unavailable";
  reason: string;
  evidence_timestamp: string;
  recommended_next_operator_action: string;
};

export type UnityReadOnlyBridgeResult = UnityReadOnlyBridgeObservation | UnityReadOnlyBridgeUnavailable;

export type UnityReadOnlyRuntimeBridge = {
  probeValidation(input: UnityReadOnlyBridgeProbeInput): UnityReadOnlyBridgeResult;
};

export function createUnavailableUnityReadOnlyRuntimeBridge(reason?: string): UnityReadOnlyRuntimeBridge {
  return {
    probeValidation(input: UnityReadOnlyBridgeProbeInput): UnityReadOnlyBridgeResult {
      return {
        bridge_status: "bridge_unavailable",
        reason: reason ?? "No Unity read-only runtime endpoint is configured for validation probes.",
        evidence_timestamp: input.requested_at,
        recommended_next_operator_action: "Keep the request in reviewed adapter-preview mode or connect a verified read-only Unity bridge before retrying.",
      };
    },
  };
}