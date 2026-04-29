type ExecutionAction = {
  type: string;
  target?: string;
};

type ExecutionPlan = {
  intent: string;
  actions: ExecutionAction[];
  requiresApproval: boolean;
};

type ExecutionReceipt = {
  status: "invalid" | "awaiting_approval" | "approved_for_dry_run" | "denied";
  receiptId: string;
  receiptTimestamp: string;
  approvalId?: string;
  reason?: string;
  plan: ExecutionPlan;
};

type ApprovalState = "pending" | "approved" | "denied";

const ALLOWED_ACTIONS = ["inspect_codebase", "target_engine", "check_null_references"];

const approvalState: ApprovalState = "pending";
const receiptId = "receipt_local_0001";
const receiptTimestamp = "2026-04-14T09:00:00Z";
const input = "Analyze a Unity null reference issue before making any changes.";

function buildPlan(request: string): ExecutionPlan {
  const normalizedRequest = request.toLowerCase();
  const actions: ExecutionAction[] = [];

  if (normalizedRequest.includes("analyze")) {
    actions.push({ type: "inspect_codebase" });
  }

  if (normalizedRequest.includes("unity")) {
    actions.push({ type: "target_engine", target: "unity" });
  }

  if (normalizedRequest.includes("null reference")) {
    actions.push({ type: "check_null_references" });
  }

  return {
    intent: request,
    actions,
    requiresApproval: true,
  };
}

function validatePlan(plan: ExecutionPlan): { valid: boolean; reason?: string } {
  for (const action of plan.actions) {
    if (!action || typeof action.type !== "string") {
      return {
        valid: false,
        reason: "Action is missing a valid type.",
      };
    }

    if (!ALLOWED_ACTIONS.includes(action.type)) {
      return {
        valid: false,
        reason: `Action type is not allowed: ${action.type}`,
      };
    }

    if (action.type === "target_engine" && !action.target) {
      return {
        valid: false,
        reason: "target_engine actions must include a target.",
      };
    }
  }

  return {
    valid: true,
  };
}

function buildReceipt(plan: ExecutionPlan, approvalState: ApprovalState): ExecutionReceipt {
  const validation = validatePlan(plan);

  if (!validation.valid) {
    return {
      status: "invalid",
      receiptId,
      receiptTimestamp,
      reason: validation.reason,
      plan,
    };
  }

  if (plan.requiresApproval && approvalState === "pending") {
    return {
      status: "awaiting_approval",
      receiptId,
      receiptTimestamp,
      approvalId: "approval_local_0001",
      plan,
    };
  }

  if (plan.requiresApproval && approvalState === "denied") {
    return {
      status: "denied",
      receiptId,
      receiptTimestamp,
      approvalId: "approval_local_0001",
      reason: "Execution plan was explicitly denied.",
      plan,
    };
  }

  return {
    status: "approved_for_dry_run",
    receiptId,
    receiptTimestamp,
    plan,
  };
}

const plan = buildPlan(input);
const receipt = buildReceipt(plan, approvalState);

console.log(JSON.stringify(receipt, null, 2));

if (receipt.status === "invalid") {
  process.exit(1);
}

process.exit(0);