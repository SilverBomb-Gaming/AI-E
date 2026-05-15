export type AutonomousTaskChainStatus =
  | "chain_planned"
  | "awaiting_chain_approval"
  | "chain_ready"
  | "chain_running"
  | "chain_paused"
  | "chain_blocked"
  | "chain_completed";

export type AutonomousTaskStepStatus =
  | "planned"
  | "ready"
  | "running"
  | "completed"
  | "paused"
  | "blocked";

export type AutonomousTaskStepRequiredGate =
  | "controlled_execution"
  | "controlled_validation"
  | "commit_gate"
  | "commit_approval"
  | "push_approval";

export type AutonomousTaskChainRiskLevel = "low" | "medium" | "high" | "blocked";

export type AutonomousTaskChainBlocker = {
  code:
    | "no_steps"
    | "max_steps_exceeded"
    | "chain_approval_required"
    | "high_risk_chain"
    | "step_result_missing"
    | "step_id_mismatch"
    | "validation_failed"
    | "rollback_recommended"
    | "commit_approval_missing"
    | "push_approval_missing"
    | "high_risk_step"
    | "chain_already_completed"
    | "chain_not_runnable";
  message: string;
  recommended_action: "approve" | "review" | "pause" | "revise";
};

export type AutonomousTaskStep = {
  step_id: string;
  order: number;
  title: string;
  source_request: string;
  planner_ready_request: string;
  status: AutonomousTaskStepStatus;
  required_gate: AutonomousTaskStepRequiredGate;
  validation_required: boolean;
  commit_allowed: boolean;
  push_allowed: boolean;
  stop_on_failure: boolean;
};

export type AutonomousTaskChainReport = {
  report_id: string;
  created_at: string;
  status: AutonomousTaskChainStatus;
  completed_steps: string[];
  pending_steps: string[];
  paused_reason?: string;
  last_completed_step_id?: string;
  summary: string;
};

export type AutonomousTaskChain = {
  chain_id: string;
  created_at: string;
  original_request: string;
  interpreted_goal: string;
  max_steps: number;
  risk_level: AutonomousTaskChainRiskLevel;
  approval_required: boolean;
  chain_approval_granted: boolean;
  steps: AutonomousTaskStep[];
  current_step_index: number;
  status: AutonomousTaskChainStatus;
  blockers: AutonomousTaskChainBlocker[];
  completion_report: AutonomousTaskChainReport;
};

export type AutonomousTaskChainInput = {
  originalRequest: string;
  interpretedGoal?: string;
  maxSteps: number;
  riskLevel?: AutonomousTaskChainRiskLevel;
  approvalRequired?: boolean;
  chainApproval?: boolean;
  requestedSteps?: Array<{
    title: string;
    sourceRequest?: string;
    plannerReadyRequest?: string;
    requiredGate?: AutonomousTaskStepRequiredGate;
    validationRequired?: boolean;
    commitAllowed?: boolean;
    pushAllowed?: boolean;
    stopOnFailure?: boolean;
  }>;
  createdAt?: string;
};

export type AutonomousTaskStepResult = {
  step_id: string;
  risk_level?: AutonomousTaskChainRiskLevel;
  validation_status?: "validation_passed" | "validation_failed" | "validation_needs_review" | "validation_blocked";
  validation_recommendation?: "keep_changes" | "rollback" | "review_required";
  commit_approval_status?: "commit_awaiting_approval" | "commit_approved" | "commit_blocked";
  push_approval_status?: "push_awaiting_approval" | "push_approved" | "push_blocked";
  rollback_recommended?: boolean;
  explanation?: string;
};

export type AutonomousTaskChainResult = {
  chain: AutonomousTaskChain;
  status: AutonomousTaskChainStatus;
  blockers: AutonomousTaskChainBlocker[];
  explanation: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "task-chain";
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildChainId(originalRequest: string, createdAt: string): string {
  return `task-chain-${sanitizeTimestamp(createdAt)}-${slugify(originalRequest)}`;
}

function buildReportId(chainId: string, createdAt: string): string {
  return `task-chain-report-${sanitizeTimestamp(createdAt)}-${slugify(chainId)}`;
}

function buildStepId(chainId: string, order: number, title: string): string {
  return `${chainId}-step-${order}-${slugify(title)}`;
}

function deriveRequestedSteps(input: AutonomousTaskChainInput): NonNullable<AutonomousTaskChainInput["requestedSteps"]> {
  if (Array.isArray(input.requestedSteps) && input.requestedSteps.length > 0) {
    return input.requestedSteps;
  }

  const originalRequest = normalizeText(input.originalRequest);
  if (!originalRequest) {
    return [];
  }

  return [{
    title: originalRequest,
    sourceRequest: originalRequest,
    plannerReadyRequest: originalRequest,
    requiredGate: "controlled_execution",
    validationRequired: true,
    commitAllowed: true,
    pushAllowed: false,
    stopOnFailure: true,
  }];
}

function buildReport(chain: AutonomousTaskChain, pausedReason?: string): AutonomousTaskChainReport {
  const completedSteps = chain.steps.filter((step) => step.status === "completed").map((step) => step.title);
  const pendingSteps = chain.steps.filter((step) => step.status !== "completed").map((step) => step.title);
  return {
    report_id: buildReportId(chain.chain_id, chain.created_at),
    created_at: chain.created_at,
    status: chain.status,
    completed_steps: completedSteps,
    pending_steps: pendingSteps,
    paused_reason: pausedReason,
    last_completed_step_id: chain.steps.filter((step) => step.status === "completed").at(-1)?.step_id,
    summary: `${chain.status}: ${completedSteps.length}/${chain.steps.length} steps completed`,
  };
}

function cloneChain(chain: AutonomousTaskChain): AutonomousTaskChain {
  return {
    ...chain,
    steps: chain.steps.map((step) => ({ ...step })),
    blockers: chain.blockers.map((blocker) => ({ ...blocker })),
    completion_report: {
      ...chain.completion_report,
      completed_steps: [...chain.completion_report.completed_steps],
      pending_steps: [...chain.completion_report.pending_steps],
    },
  };
}

export function createAutonomousTaskChain(input: AutonomousTaskChainInput): AutonomousTaskChainResult {
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const originalRequest = normalizeText(input.originalRequest);
  const interpretedGoal = normalizeText(input.interpretedGoal) || originalRequest;
  const requestedSteps = deriveRequestedSteps(input);
  const chainId = buildChainId(originalRequest || interpretedGoal || "task-chain", createdAt);
  const riskLevel = input.riskLevel ?? "low";
  const blockers: AutonomousTaskChainBlocker[] = [];

  if (requestedSteps.length === 0) {
    blockers.push({
      code: "no_steps",
      message: "Autonomous task chaining requires at least one bounded task step.",
      recommended_action: "revise",
    });
  }

  if (requestedSteps.length > input.maxSteps) {
    blockers.push({
      code: "max_steps_exceeded",
      message: `Requested task chain has ${requestedSteps.length} step(s), which exceeds the max_steps limit of ${input.maxSteps}.`,
      recommended_action: "revise",
    });
  }

  const steps: AutonomousTaskStep[] = requestedSteps.slice(0, input.maxSteps).map((step, index) => ({
    step_id: buildStepId(chainId, index + 1, step.title),
    order: index + 1,
    title: normalizeText(step.title) || `Task step ${index + 1}`,
    source_request: normalizeText(step.sourceRequest) || normalizeText(step.title),
    planner_ready_request: normalizeText(step.plannerReadyRequest) || normalizeText(step.sourceRequest) || normalizeText(step.title),
    status: "planned",
    required_gate: step.requiredGate ?? "controlled_execution",
    validation_required: step.validationRequired ?? true,
    commit_allowed: step.commitAllowed ?? true,
    push_allowed: step.pushAllowed ?? false,
    stop_on_failure: step.stopOnFailure ?? true,
  }));

  const chain: AutonomousTaskChain = {
    chain_id: chainId,
    created_at: createdAt,
    original_request: originalRequest,
    interpreted_goal: interpretedGoal,
    max_steps: input.maxSteps,
    risk_level: riskLevel,
    approval_required: input.approvalRequired !== false,
    chain_approval_granted: input.chainApproval === true,
    steps,
    current_step_index: 0,
    status: blockers.length > 0 ? "chain_blocked" : "chain_planned",
    blockers,
    completion_report: {
      report_id: buildReportId(chainId, createdAt),
      created_at: createdAt,
      status: blockers.length > 0 ? "chain_blocked" : "chain_planned",
      completed_steps: [],
      pending_steps: steps.map((step) => step.title),
      summary: blockers.length > 0 ? "chain_blocked: planning failed" : `chain_planned: 0/${steps.length} steps completed`,
    },
  };

  if (blockers.length > 0) {
    return {
      chain,
      status: chain.status,
      blockers,
      explanation: `Autonomous task chain could not be created because ${blockers.map((blocker) => blocker.message).join(" ")}`,
    };
  }

  return {
    chain,
    status: chain.status,
    blockers: [],
    explanation: `Autonomous task chain planned ${steps.length} bounded step(s) from the request.`,
  };
}

export function evaluateTaskChainReadiness(chain: AutonomousTaskChain): AutonomousTaskChainResult {
  const nextChain = cloneChain(chain);
  const blockers = [...nextChain.blockers];

  if (nextChain.risk_level === "high" || nextChain.risk_level === "blocked") {
    blockers.push({
      code: "high_risk_chain",
      message: `Autonomous task chain is blocked while risk level is ${nextChain.risk_level}.`,
      recommended_action: "review",
    });
    nextChain.status = "chain_blocked";
    nextChain.blockers = blockers;
    nextChain.completion_report = buildReport(nextChain);
    return {
      chain: nextChain,
      status: nextChain.status,
      blockers,
      explanation: `Autonomous task chain is blocked because ${blockers.map((blocker) => blocker.message).join(" ")}`,
    };
  }

  if (nextChain.approval_required && nextChain.chain_approval_granted !== true) {
    blockers.push({
      code: "chain_approval_required",
      message: "Autonomous task chain requires explicit approval before execution can begin.",
      recommended_action: "approve",
    });
    nextChain.status = "awaiting_chain_approval";
    nextChain.blockers = blockers;
    nextChain.completion_report = buildReport(nextChain, blockers.at(-1)?.message);
    return {
      chain: nextChain,
      status: nextChain.status,
      blockers,
      explanation: "Autonomous task chain is ready in principle but remains awaiting explicit chain approval.",
    };
  }

  if (nextChain.steps.length > 0 && nextChain.current_step_index < nextChain.steps.length) {
    nextChain.steps[nextChain.current_step_index] = {
      ...nextChain.steps[nextChain.current_step_index],
      status: "ready",
    };
  }
  nextChain.status = "chain_ready";
  nextChain.blockers = [];
  nextChain.completion_report = buildReport(nextChain);

  return {
    chain: nextChain,
    status: nextChain.status,
    blockers: [],
    explanation: "Autonomous task chain is ready to run under the existing controlled execution gates.",
  };
}

export function pauseTaskChain(chain: AutonomousTaskChain, reason: string): AutonomousTaskChainResult {
  const nextChain = cloneChain(chain);
  const blocker: AutonomousTaskChainBlocker = {
    code: "chain_not_runnable",
    message: normalizeText(reason) || "Autonomous task chain was paused by the coordinator.",
    recommended_action: "pause",
  };
  if (nextChain.steps[nextChain.current_step_index]) {
    nextChain.steps[nextChain.current_step_index] = {
      ...nextChain.steps[nextChain.current_step_index],
      status: "paused",
    };
  }
  nextChain.status = "chain_paused";
  nextChain.blockers = [blocker];
  nextChain.completion_report = buildReport(nextChain, blocker.message);
  return {
    chain: nextChain,
    status: nextChain.status,
    blockers: nextChain.blockers,
    explanation: blocker.message,
  };
}

export function completeTaskChain(chain: AutonomousTaskChain): AutonomousTaskChainResult {
  const nextChain = cloneChain(chain);
  nextChain.status = "chain_completed";
  nextChain.blockers = [];
  nextChain.completion_report = buildReport(nextChain);
  return {
    chain: nextChain,
    status: nextChain.status,
    blockers: [],
    explanation: `Autonomous task chain completed ${nextChain.steps.length} supervised step(s) without bypassing any safety gate.`,
  };
}

export function advanceTaskChain(chain: AutonomousTaskChain, stepResult: AutonomousTaskStepResult | null): AutonomousTaskChainResult {
  const nextChain = cloneChain(chain);

  if (nextChain.status === "chain_completed") {
    const blocker: AutonomousTaskChainBlocker = {
      code: "chain_already_completed",
      message: "Autonomous task chain has already completed and cannot advance further.",
      recommended_action: "review",
    };
    nextChain.blockers = [blocker];
    return {
      chain: nextChain,
      status: nextChain.status,
      blockers: nextChain.blockers,
      explanation: blocker.message,
    };
  }

  if (!stepResult) {
    return pauseTaskChain(nextChain, "Autonomous task chain paused because no step result was provided.");
  }

  const currentStep = nextChain.steps[nextChain.current_step_index];
  if (!currentStep) {
    return pauseTaskChain(nextChain, "Autonomous task chain paused because no current step is available to advance.");
  }

  if (stepResult.step_id !== currentStep.step_id) {
    const paused = pauseTaskChain(nextChain, `Autonomous task chain paused because step result ${stepResult.step_id} does not match current step ${currentStep.step_id}.`);
    paused.chain.blockers = [{
      code: "step_id_mismatch",
      message: paused.explanation,
      recommended_action: "review",
    }];
    paused.chain.completion_report = buildReport(paused.chain, paused.explanation);
    return {
      ...paused,
      blockers: paused.chain.blockers,
    };
  }

  if (stepResult.risk_level === "high" || stepResult.risk_level === "blocked") {
    const paused = pauseTaskChain(nextChain, `Autonomous task chain paused because step ${currentStep.title} became ${stepResult.risk_level} risk.`);
    paused.chain.blockers = [{
      code: "high_risk_step",
      message: paused.explanation,
      recommended_action: "review",
    }];
    paused.chain.completion_report = buildReport(paused.chain, paused.explanation);
    return {
      ...paused,
      blockers: paused.chain.blockers,
    };
  }

  if (stepResult.validation_status === "validation_failed" || stepResult.validation_status === "validation_blocked") {
    const paused = pauseTaskChain(nextChain, `Autonomous task chain paused because validation for step ${currentStep.title} did not pass.`);
    paused.chain.blockers = [{
      code: "validation_failed",
      message: paused.explanation,
      recommended_action: "review",
    }];
    paused.chain.completion_report = buildReport(paused.chain, paused.explanation);
    return {
      ...paused,
      blockers: paused.chain.blockers,
    };
  }

  if (stepResult.rollback_recommended === true || stepResult.validation_recommendation === "rollback") {
    const paused = pauseTaskChain(nextChain, `Autonomous task chain paused because rollback was recommended for step ${currentStep.title}.`);
    paused.chain.blockers = [{
      code: "rollback_recommended",
      message: paused.explanation,
      recommended_action: "review",
    }];
    paused.chain.completion_report = buildReport(paused.chain, paused.explanation);
    return {
      ...paused,
      blockers: paused.chain.blockers,
    };
  }

  if (currentStep.commit_allowed && stepResult.commit_approval_status !== "commit_approved") {
    const paused = pauseTaskChain(nextChain, `Autonomous task chain paused because commit approval is missing for step ${currentStep.title}.`);
    paused.chain.blockers = [{
      code: "commit_approval_missing",
      message: paused.explanation,
      recommended_action: "approve",
    }];
    paused.chain.completion_report = buildReport(paused.chain, paused.explanation);
    return {
      ...paused,
      blockers: paused.chain.blockers,
    };
  }

  if (currentStep.push_allowed && stepResult.push_approval_status !== "push_approved") {
    const paused = pauseTaskChain(nextChain, `Autonomous task chain paused because push approval is missing for step ${currentStep.title}.`);
    paused.chain.blockers = [{
      code: "push_approval_missing",
      message: paused.explanation,
      recommended_action: "approve",
    }];
    paused.chain.completion_report = buildReport(paused.chain, paused.explanation);
    return {
      ...paused,
      blockers: paused.chain.blockers,
    };
  }

  nextChain.steps[nextChain.current_step_index] = {
    ...currentStep,
    status: "completed",
  };
  nextChain.current_step_index += 1;

  if (nextChain.current_step_index >= nextChain.steps.length) {
    return completeTaskChain(nextChain);
  }

  nextChain.steps[nextChain.current_step_index] = {
    ...nextChain.steps[nextChain.current_step_index],
    status: "ready",
  };
  nextChain.status = "chain_running";
  nextChain.blockers = [];
  nextChain.completion_report = buildReport(nextChain);

  return {
    chain: nextChain,
    status: nextChain.status,
    blockers: [],
    explanation: `Autonomous task chain advanced past step ${currentStep.order} and is ready for step ${nextChain.current_step_index + 1}.`,
  };
}

export function summarizeTaskChain(chain: AutonomousTaskChain): string {
  return [
    `Task chain status: ${chain.status}`,
    `Risk level: ${chain.risk_level}`,
    `Current step index: ${chain.current_step_index}`,
    `Total steps: ${chain.steps.length}`,
    `Completed steps: ${chain.completion_report.completed_steps.length}`,
    `Summary: ${chain.completion_report.summary}`,
  ].join("\n");
}