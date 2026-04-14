type ExecutionAction = {
  type: string;
  target?: string;
};

type ExecutionPlan = {
  intent: string;
  actions: ExecutionAction[];
  requiresApproval: boolean;
};

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

const plan = buildPlan(input);

console.log(JSON.stringify(plan, null, 2));