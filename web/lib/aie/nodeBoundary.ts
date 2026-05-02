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

export type NodePlanningInput = {
  planning_hint: string[];
  validation_hint: string[];
  dependency_hint: string[];
};

export type NodeBoundaryEvidenceLabel =
  | "NODE INTENT RECEIVED"
  | "NODE BOUNDARY CHECK PASSED"
  | "NODE BOUNDARY CHECK FAILED"
  | "NODE INTENT ACCEPTED FOR REVIEW"
  | "NODE DIRECT EXECUTION BLOCKED"
  | "NODE DIRECT ROLLBACK BLOCKED"
  | "NODE PLANNING HINT RECEIVED"
  | "NODE PLANNING HINT APPLIED"
  | "NODE PLANNING HINT REJECTED"
  | "NODE PLANNING CONFLICT RESOLVED"
  | "CORE TASK TRANSLATION GENERATED"
  | "TASK STORED AS DRAFT ONLY"
  | "NODE EXECUTION NOT TRIGGERED";

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
  accepted_planning_input: NodePlanningInput | null;
};

export type NodeAdvisoryPlanningStage = "strategy" | "planning";

export type NodeAdvisoryPlan = {
  plan_id: string;
  planning_stage: NodeAdvisoryPlanningStage;
  execution_path: typeof EXECUTION_PATH;
  planning_suggestions: string[];
  validation_insights: string[];
  dependency_reasoning: string[];
  validation_gates: string[];
  execution_authority: "system_only";
};

export type NodePlanningMergeResult = {
  merged_plan: NodeAdvisoryPlan;
  node_hints_visible: NodePlanningInput;
  applied_hints: NodePlanningInput;
  rejected_hints: NodePlanningInput;
  conflict_overrides: Array<{
    hint_type: keyof NodePlanningInput;
    hint: string;
    system_reason: string;
  }>;
  evidence_labels: NodeBoundaryEvidenceLabel[];
};

export type NodeTaskRiskLevel = "low" | "medium" | "high";

export type CoreNodeTaskTranslationPlan = NodeAdvisoryPlan & {
  node_id: string;
  target_node_id: string;
  command: string;
  requires_sudo?: false;
  risk_level?: NodeTaskRiskLevel;
};

export type NodeTaskDraft = {
  task_id: string;
  node_id: string;
  target_node_id: string;
  command: string;
  requires_sudo: false;
  risk_level: NodeTaskRiskLevel;
  approval_status: "pending";
  signature: null;
};

export type NodeTaskDraftValidationResult = {
  ok: boolean;
  reason: string | null;
  evidence_labels: NodeBoundaryEvidenceLabel[];
  draft: NodeTaskDraft | null;
};

export type NodeTaskTranslationResult = {
  status: "draft_generated" | "draft_rejected";
  reason: string;
  evidence_labels: NodeBoundaryEvidenceLabel[];
  draft: NodeTaskDraft | null;
  stored_as_draft_only: true;
  submitted_to_node: false;
  node_intake_triggered: false;
  execution_triggered: false;
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

function normalizeHintList(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeNodePlanningInput(payload: unknown): NodePlanningInput {
  if (!isRecord(payload)) {
    return {
      planning_hint: [],
      validation_hint: [],
      dependency_hint: [],
    };
  }

  return {
    planning_hint: normalizeHintList(payload.planning_hint),
    validation_hint: normalizeHintList(payload.validation_hint),
    dependency_hint: normalizeHintList(payload.dependency_hint),
  };
}

function hasAnyNodePlanningHint(input: NodePlanningInput): boolean {
  return input.planning_hint.length > 0 || input.validation_hint.length > 0 || input.dependency_hint.length > 0;
}

function containsAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function hintRequestsGateBypass(hint: string): boolean {
  const normalized = hint.toLowerCase();

  return containsAny(normalized, [
    "skip validation",
    "bypass validation",
    "skip gate",
    "bypass gate",
    "ignore review",
    "skip review",
    "skip studio control",
    "bypass studio control",
    "approve automatically",
    "execute automatically",
    "run without approval",
  ]);
}

function hintConflictsWithSystemPlan(hint: string, systemValues: string[]): boolean {
  const normalizedHint = hint.toLowerCase();
  return systemValues.some((value) => normalizedHint === value.toLowerCase());
}

function inferNodeTaskRiskLevel(command: string): NodeTaskRiskLevel {
  const normalized = command.toLowerCase();

  if (containsAny(normalized, ["inspect", "summarize", "check", "validate", "verify", "review"])) {
    return "low";
  }

  if (containsAny(normalized, ["build", "compile", "test", "trace", "analyze"])) {
    return "medium";
  }

  return "high";
}

function commandLooksUnsafe(command: string): boolean {
  const normalized = command.toLowerCase();

  return containsAny(normalized, [
    "sudo",
    "runas",
    "chmod 777",
    "rm -rf",
    "del /f",
    "format ",
    "shutdown",
    "restart-computer",
    "invoke-expression",
    "powershell -encodedcommand",
    "curl ",
    "wget ",
    "| bash",
    "| sh",
    "git push",
    "npm publish",
    "unity.exe",
    "start-process",
  ]);
}

function parseCoreNodeTaskTranslationPlan(plan: unknown): CoreNodeTaskTranslationPlan | null {
  if (!isRecord(plan)) {
    return null;
  }

  if (
    !hasNonEmptyString(plan.plan_id)
    || (plan.planning_stage !== "strategy" && plan.planning_stage !== "planning")
    || plan.execution_path !== EXECUTION_PATH
    || !Array.isArray(plan.planning_suggestions)
    || !Array.isArray(plan.validation_insights)
    || !Array.isArray(plan.dependency_reasoning)
    || !Array.isArray(plan.validation_gates)
    || plan.execution_authority !== "system_only"
    || !hasNonEmptyString(plan.node_id)
    || !hasNonEmptyString(plan.target_node_id)
    || !hasNonEmptyString(plan.command)
  ) {
    return null;
  }

  if (plan.requires_sudo !== undefined && plan.requires_sudo !== false) {
    return null;
  }

  if (
    plan.risk_level !== undefined
    && plan.risk_level !== "low"
    && plan.risk_level !== "medium"
    && plan.risk_level !== "high"
  ) {
    return null;
  }

  return {
    plan_id: plan.plan_id,
    planning_stage: plan.planning_stage,
    execution_path: EXECUTION_PATH,
    planning_suggestions: (plan.planning_suggestions as unknown[]).filter((item): item is string => typeof item === "string"),
    validation_insights: (plan.validation_insights as unknown[]).filter((item): item is string => typeof item === "string"),
    dependency_reasoning: (plan.dependency_reasoning as unknown[]).filter((item): item is string => typeof item === "string"),
    validation_gates: (plan.validation_gates as unknown[]).filter((item): item is string => typeof item === "string"),
    execution_authority: "system_only",
    node_id: plan.node_id,
    target_node_id: plan.target_node_id,
    command: plan.command.trim(),
    requires_sudo: false,
    risk_level: plan.risk_level,
  };
}

export function validateNodeTaskDraft(draft: unknown): NodeTaskDraftValidationResult {
  const evidenceLabels: NodeBoundaryEvidenceLabel[] = [];

  if (!isRecord(draft)) {
    return {
      ok: false,
      reason: "Node task draft is invalid. Expected a structured unsigned draft object.",
      evidence_labels: evidenceLabels,
      draft: null,
    };
  }

  if (
    !hasNonEmptyString(draft.task_id)
    || !hasNonEmptyString(draft.node_id)
    || !hasNonEmptyString(draft.target_node_id)
    || !hasNonEmptyString(draft.command)
    || draft.requires_sudo !== false
    || (draft.risk_level !== "low" && draft.risk_level !== "medium" && draft.risk_level !== "high")
    || draft.approval_status !== "pending"
    || draft.signature !== null
  ) {
    return {
      ok: false,
      reason: "Node task draft schema does not match the unsigned pending Node contract.",
      evidence_labels: evidenceLabels,
      draft: null,
    };
  }

  if (commandLooksUnsafe(draft.command)) {
    return {
      ok: false,
      reason: "Node task draft command is unsafe. Core can only generate bounded safe drafts and cannot encode privileged or execution-triggering commands.",
      evidence_labels: evidenceLabels,
      draft: null,
    };
  }

  return {
    ok: true,
    reason: null,
    evidence_labels: evidenceLabels,
    draft: {
      task_id: draft.task_id,
      node_id: draft.node_id,
      target_node_id: draft.target_node_id,
      command: draft.command,
      requires_sudo: false,
      risk_level: draft.risk_level,
      approval_status: "pending",
      signature: null,
    },
  };
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

  const planningInput = normalizeNodePlanningInput(parsed.payload);
  if (hasAnyNodePlanningHint(planningInput)) {
    evidenceLabels.push("NODE PLANNING HINT RECEIVED");
  }

  const allHints = [...planningInput.planning_hint, ...planningInput.validation_hint, ...planningInput.dependency_hint];
  if (allHints.some((hint) => hintRequestsGateBypass(hint))) {
    evidenceLabels.push("NODE BOUNDARY CHECK FAILED", "NODE PLANNING HINT REJECTED");
    return {
      ok: false,
      category: "boundary_violation",
      reason: "Node planning hints cannot bypass validation, review, delivery, or Studio Control gates.",
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
      accepted_planning_input: null,
    };
  }

  const acceptedPlanningInput = normalizeNodePlanningInput(validation.envelope?.payload);

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
    accepted_planning_input: acceptedPlanningInput,
  };
}

export function mergeNodePlanningHints(systemPlan: NodeAdvisoryPlan, nodeHints: NodePlanningInput): NodePlanningMergeResult {
  const evidenceLabels: NodeBoundaryEvidenceLabel[] = [];

  if (hasAnyNodePlanningHint(nodeHints)) {
    evidenceLabels.push("NODE PLANNING HINT RECEIVED");
  }

  const appliedHints: NodePlanningInput = {
    planning_hint: [],
    validation_hint: [],
    dependency_hint: [],
  };

  const rejectedHints: NodePlanningInput = {
    planning_hint: [],
    validation_hint: [],
    dependency_hint: [],
  };

  const conflictOverrides: NodePlanningMergeResult["conflict_overrides"] = [];

  const mergedPlan: NodeAdvisoryPlan = {
    ...systemPlan,
    planning_suggestions: [...systemPlan.planning_suggestions],
    validation_insights: [...systemPlan.validation_insights],
    dependency_reasoning: [...systemPlan.dependency_reasoning],
    validation_gates: [...systemPlan.validation_gates],
    execution_authority: "system_only",
    execution_path: EXECUTION_PATH,
  };

  const applyHint = (
    hintType: keyof NodePlanningInput,
    target: "planning_suggestions" | "validation_insights" | "dependency_reasoning",
    systemReason: string,
  ) => {
    for (const hint of nodeHints[hintType]) {
      if (hintRequestsGateBypass(hint)) {
        rejectedHints[hintType].push(hint);
        continue;
      }

      if (hintConflictsWithSystemPlan(hint, mergedPlan[target])) {
        rejectedHints[hintType].push(hint);
        conflictOverrides.push({
          hint_type: hintType,
          hint,
          system_reason: systemReason,
        });
        continue;
      }

      if (!mergedPlan[target].some((item) => item.toLowerCase() === hint.toLowerCase())) {
        mergedPlan[target].push(hint);
      }
      appliedHints[hintType].push(hint);
    }
  };

  applyHint("planning_hint", "planning_suggestions", "System planning suggestions remain authoritative.");
  applyHint("validation_hint", "validation_insights", "System validation gates and insights remain authoritative.");
  applyHint("dependency_hint", "dependency_reasoning", "System dependency reasoning remains authoritative.");

  if (appliedHints.planning_hint.length || appliedHints.validation_hint.length || appliedHints.dependency_hint.length) {
    evidenceLabels.push("NODE PLANNING HINT APPLIED");
  }

  if (rejectedHints.planning_hint.length || rejectedHints.validation_hint.length || rejectedHints.dependency_hint.length) {
    evidenceLabels.push("NODE PLANNING HINT REJECTED");
  }

  if (conflictOverrides.length > 0) {
    evidenceLabels.push("NODE PLANNING CONFLICT RESOLVED");
  }

  return {
    merged_plan: mergedPlan,
    node_hints_visible: {
      planning_hint: [...nodeHints.planning_hint],
      validation_hint: [...nodeHints.validation_hint],
      dependency_hint: [...nodeHints.dependency_hint],
    },
    applied_hints: appliedHints,
    rejected_hints: rejectedHints,
    conflict_overrides: conflictOverrides,
    evidence_labels: evidenceLabels,
  };
}

export function translatePlanToNodeTask(plan: unknown): NodeTaskTranslationResult {
  const parsedPlan = parseCoreNodeTaskTranslationPlan(plan);

  if (!parsedPlan) {
    return {
      status: "draft_rejected",
      reason: "Core plan cannot be translated into a Node task draft. The plan must include explicit node routing, the bounded execution path, and a safe command.",
      evidence_labels: [],
      draft: null,
      stored_as_draft_only: true,
      submitted_to_node: false,
      node_intake_triggered: false,
      execution_triggered: false,
    };
  }

  const draft: NodeTaskDraft = {
    task_id: `node-task-${parsedPlan.plan_id}`,
    node_id: parsedPlan.node_id,
    target_node_id: parsedPlan.target_node_id,
    command: parsedPlan.command,
    requires_sudo: false,
    risk_level: parsedPlan.risk_level ?? inferNodeTaskRiskLevel(parsedPlan.command),
    approval_status: "pending",
    signature: null,
  };

  const validation = validateNodeTaskDraft(draft);
  if (!validation.ok) {
    return {
      status: "draft_rejected",
      reason: validation.reason ?? "Node task draft validation failed.",
      evidence_labels: validation.evidence_labels,
      draft: null,
      stored_as_draft_only: true,
      submitted_to_node: false,
      node_intake_triggered: false,
      execution_triggered: false,
    };
  }

  return {
    status: "draft_generated",
    reason: "Core translated the advisory plan into a Node-compatible draft only. Signature, submission, intake, and execution remain blocked pending operator-gated Node intake.",
    evidence_labels: [
      "CORE TASK TRANSLATION GENERATED",
      "TASK STORED AS DRAFT ONLY",
      "NODE EXECUTION NOT TRIGGERED",
    ],
    draft: validation.draft,
    stored_as_draft_only: true,
    submitted_to_node: false,
    node_intake_triggered: false,
    execution_triggered: false,
  };
}