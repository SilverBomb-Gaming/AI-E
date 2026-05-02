const EXECUTION_PATH = "Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control" as const;

export type NodeIntentKind = "execution_request" | "validation_request" | "status_request";

export type NodeIntentEnvelope = {
  source: "aie_node";
  node_id: string;
  intent_id: string;
  requested_at: string;
  operator_visible_summary: string;
  intent_kind: NodeIntentKind;
  payload: unknown;
  permissions: {
    can_execute: false;
    can_approve: false;
    can_rollback: false;
  };
};

export type NodeBoundaryEvidenceLabel =
  | "NODE INTENT RECEIVED"
  | "NODE BOUNDARY CHECK PASSED"
  | "NODE BOUNDARY CHECK FAILED"
  | "NODE INTENT ACCEPTED FOR REVIEW"
  | "NODE DIRECT EXECUTION BLOCKED"
  | "NODE DIRECT ROLLBACK BLOCKED";

export type NodeIntentReceiptStatus = "accepted_for_review" | "rejected_boundary_violation" | "rejected_invalid_envelope";

export type NodeIntentValidationResult = {
  ok: boolean;
  category: "passed" | "invalid_envelope" | "boundary_violation";
  reason: string | null;
  evidence_labels: NodeBoundaryEvidenceLabel[];
  envelope: NodeIntentEnvelope | null;
};

export type NodeIntentReceipt = {
  status: NodeIntentReceiptStatus;
  reason: string;
  evidence_labels: NodeBoundaryEvidenceLabel[];
  execution_path: typeof EXECUTION_PATH;
  review_status: "pending_review" | "blocked";
  mutating: false;
  rollback_triggered: false;
  node_can_execute: false;
  node_can_approve: false;
  node_can_rollback: false;
  unity_access: "blocked";
  accepted_intent_kind: NodeIntentKind | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function looksLikeIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value.toLowerCase()];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStrings(item));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, nested]) => [key.toLowerCase(), ...flattenStrings(nested)]);
  }
  return [];
}

function containsAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function payloadRequestsDirectRollback(payload: unknown): boolean {
  const flattened = flattenStrings(payload);
  const joined = flattened.join(" ");

  return containsAny(joined, [
    "rollback",
    "roll back",
    "manual_rollback",
    "execute rollback",
    "direct rollback",
    "unity_scene_object_removal",
    "controlled_rollback",
  ]);
}

function payloadRequestsDirectMutation(payload: unknown): boolean {
  const flattened = flattenStrings(payload);
  const joined = flattened.join(" ");

  return containsAny(joined, [
    "execute now",
    "direct execute",
    "run immediately",
    "mutate unity",
    "unity mutation",
    "create object",
    "spawn object",
    "scene_object_creation",
    "unity_scene_object_creation",
  ]);
}

function payloadBypassesExecutionPath(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = key.toLowerCase();

    if (["execution_path", "requested_execution_path", "route_path", "approval_path"].includes(normalizedKey)) {
      if (!hasNonEmptyString(value) || value !== EXECUTION_PATH) {
        return true;
      }
      continue;
    }

    if (["next_stage", "target_stage", "direct_stage", "bypass_stage"].includes(normalizedKey)) {
      if (typeof value === "string" && value.toLowerCase() !== "strategy") {
        return true;
      }
    }

    if (normalizedKey.includes("skip_") || normalizedKey.includes("bypass")) {
      return true;
    }

    if (typeof value === "string") {
      const normalizedValue = value.toLowerCase();
      if (containsAny(normalizedValue, [
        "skip strategy",
        "skip planning",
        "skip review",
        "skip delivery",
        "skip studio control",
        "bypass strategy",
        "bypass planning",
        "bypass review",
        "bypass delivery",
        "bypass studio control",
        "direct to execution",
        "direct to unity",
      ])) {
        return true;
      }
    }

    if (isRecord(value) && payloadBypassesExecutionPath(value)) {
      return true;
    }

    if (Array.isArray(value) && value.some((item) => payloadBypassesExecutionPath(item))) {
      return true;
    }
  }

  return false;
}

function parseNodeIntentEnvelope(envelope: unknown): NodeIntentEnvelope | null {
  if (!isRecord(envelope)) {
    return null;
  }

  const permissions = envelope.permissions;
  if (!isRecord(permissions)) {
    return null;
  }

  if (
    envelope.source !== "aie_node"
    || !hasNonEmptyString(envelope.node_id)
    || !hasNonEmptyString(envelope.intent_id)
    || !hasNonEmptyString(envelope.requested_at)
    || !looksLikeIsoTimestamp(envelope.requested_at)
    || !hasNonEmptyString(envelope.operator_visible_summary)
    || !["execution_request", "validation_request", "status_request"].includes(String(envelope.intent_kind))
    || typeof permissions.can_execute !== "boolean"
    || typeof permissions.can_approve !== "boolean"
    || typeof permissions.can_rollback !== "boolean"
  ) {
    return null;
  }

  return {
    source: "aie_node",
    node_id: envelope.node_id,
    intent_id: envelope.intent_id,
    requested_at: envelope.requested_at,
    operator_visible_summary: envelope.operator_visible_summary,
    intent_kind: envelope.intent_kind as NodeIntentKind,
    payload: envelope.payload,
    permissions: {
      can_execute: permissions.can_execute as false,
      can_approve: permissions.can_approve as false,
      can_rollback: permissions.can_rollback as false,
    },
  };
}

export function validateNodeIntentEnvelope(envelope: unknown): NodeIntentValidationResult {
  const evidenceLabels: NodeBoundaryEvidenceLabel[] = ["NODE INTENT RECEIVED"];
  const parsed = parseNodeIntentEnvelope(envelope);

  if (!parsed) {
    evidenceLabels.push("NODE BOUNDARY CHECK FAILED");
    return {
      ok: false,
      category: "invalid_envelope",
      reason: "Node intent envelope is invalid. Review-only intake requires the typed aie_node envelope.",
      evidence_labels: evidenceLabels,
      envelope: null,
    };
  }

  if (parsed.permissions.can_execute || parsed.permissions.can_approve || parsed.permissions.can_rollback) {
    evidenceLabels.push("NODE BOUNDARY CHECK FAILED");
    return {
      ok: false,
      category: "boundary_violation",
      reason: "Node intent permissions exceed the review-only boundary. Node cannot execute, approve, or rollback.",
      evidence_labels: evidenceLabels,
      envelope: parsed,
    };
  }

  if (payloadRequestsDirectRollback(parsed.payload)) {
    evidenceLabels.push("NODE BOUNDARY CHECK FAILED", "NODE DIRECT ROLLBACK BLOCKED");
    return {
      ok: false,
      category: "boundary_violation",
      reason: "Node requested direct rollback. Rollback stays manual-only through Studio Control and cannot be triggered by Node.",
      evidence_labels: evidenceLabels,
      envelope: parsed,
    };
  }

  if (payloadRequestsDirectMutation(parsed.payload)) {
    evidenceLabels.push("NODE BOUNDARY CHECK FAILED", "NODE DIRECT EXECUTION BLOCKED");
    return {
      ok: false,
      category: "boundary_violation",
      reason: "Node requested direct execution or Unity mutation. Node can submit reviewable intent only.",
      evidence_labels: evidenceLabels,
      envelope: parsed,
    };
  }

  if (payloadBypassesExecutionPath(parsed.payload)) {
    evidenceLabels.push("NODE BOUNDARY CHECK FAILED");
    return {
      ok: false,
      category: "boundary_violation",
      reason: "Node intent bypasses the required Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control path.",
      evidence_labels: evidenceLabels,
      envelope: parsed,
    };
  }

  evidenceLabels.push("NODE BOUNDARY CHECK PASSED");
  return {
    ok: true,
    category: "passed",
    reason: null,
    evidence_labels: evidenceLabels,
    envelope: parsed,
  };
}

export function receiveNodeIntent(envelope: unknown): NodeIntentReceipt {
  const validation = validateNodeIntentEnvelope(envelope);

  if (!validation.ok) {
    return {
      status: validation.category === "invalid_envelope" ? "rejected_invalid_envelope" : "rejected_boundary_violation",
      reason: validation.reason ?? "Node boundary validation failed.",
      evidence_labels: validation.evidence_labels,
      execution_path: EXECUTION_PATH,
      review_status: "blocked",
      mutating: false,
      rollback_triggered: false,
      node_can_execute: false,
      node_can_approve: false,
      node_can_rollback: false,
      unity_access: "blocked",
      accepted_intent_kind: null,
    };
  }

  return {
    status: "accepted_for_review",
    reason: "Node intent was accepted as reviewable input only. Strategy, Planning, Review, Delivery, Studio Control, and manual approval still gate any future core execution.",
    evidence_labels: [...validation.evidence_labels, "NODE INTENT ACCEPTED FOR REVIEW"],
    execution_path: EXECUTION_PATH,
    review_status: "pending_review",
    mutating: false,
    rollback_triggered: false,
    node_can_execute: false,
    node_can_approve: false,
    node_can_rollback: false,
    unity_access: "blocked",
    accepted_intent_kind: validation.envelope?.intent_kind ?? null,
  };
}