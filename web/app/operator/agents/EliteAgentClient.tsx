"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { LiteEliteRunResult } from "@/lib/aie/liteEliteAgentRuntime";
import {
  advanceEliteAgentWorkflow,
  buildEliteAgentApprovalGateGuidance,
  buildEliteAgentBlockedWorkflowRecoveryGuidance,
  buildEliteAgentWorkflowSession,
  convertBlockedWorkflowToSafePatchPreparation,
  listEliteAgentWorkflowStageDefinitions,
  markEliteAgentWorkflowValidation,
  resumeEliteAgentWorkflow,
  summarizeEliteAgentWorkflow,
  type EliteAgentWorkflowSession,
  type EliteAgentWorkflowStage,
  type EliteAgentBlockedWorkflowRecoveryActionId,
  type EliteAgentApprovalGateGuidance,
} from "@/lib/aie/eliteAgentWorkflowEngine";
import {
  createAgentWorkflowHistoryStore,
  listFailedAgentWorkflows,
  listRecentAgentWorkflows,
  listResumableAgentWorkflows,
  recordAgentWorkflowHistory,
  summarizeAgentWorkflowHistory,
  type AgentWorkflowHistoryStore,
} from "@/lib/aie/agentWorkflowHistory";

const sampleTask = {
  taskId: "lite-agent-sample-task",
  title: "Prepare bounded local executor artifact",
  userGoal: "Write a scoped sample artifact and report verification truthfully.",
  repoScope: "runner_artifacts/lite_elite_agent",
  allowedPaths: ["runner_artifacts/lite_elite_agent"],
  forbiddenPaths: [".git", "node_modules", "web/node_modules", ".env", "web/.env"],
  expectedOutputs: ["runner_artifacts/lite_elite_agent/sample_agent_output.txt"],
  verificationCommands: ["git diff --name-only"],
  riskLevel: "low",
  requiresHumanApprovalBeforeWrite: false,
  approvedForWrite: true,
  filesToInspect: ["runner_artifacts/lite_elite_agent/sample_agent_output.txt"],
  requestedChanges: [{
    path: "runner_artifacts/lite_elite_agent/sample_agent_output.txt",
    content: "AI-E-lite bounded local executor sample output.\n",
    description: "Write a scoped sample artifact under the allowed runner_artifacts path.",
  }],
};

const sampleAgent = {
  agentId: "lite-elite-repo-maintainer-01",
  name: "AI-E Lite Operations Agent",
  role: "repo-maintainer",
  allowedPaths: ["runner_artifacts/lite_elite_agent"],
  blockedPaths: [".git", "node_modules", "web/node_modules", ".env", "web/.env", "package-lock.json"],
  allowedCommands: ["git diff --name-only"],
  maxSteps: 7,
};

const examplePrompts = [
  "inspect the inventory system",
  "prepare a movement patch",
  "apply the patch automatically",
  "verify latest gameplay patch",
];

const workflowStageDefinitions = listEliteAgentWorkflowStageDefinitions(sampleAgent.allowedPaths);

function statusClass(status: string): string {
  if (/completed|success|approved/.test(status)) {
    return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-300/40 dark:bg-emerald-400/10 dark:text-emerald-100";
  }
  if (/blocked|failed|interrupted|rejected/.test(status)) {
    return "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-300/40 dark:bg-rose-400/10 dark:text-rose-100";
  }
  if (/running|validating|resumable/.test(status)) {
    return "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-300/40 dark:bg-cyan-400/10 dark:text-cyan-100";
  }
  return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-300/40 dark:bg-amber-400/10 dark:text-amber-100";
}

function stageLabel(stageType: string | null): string {
  if (!stageType) {
    return "No active step";
  }
  const labels: Record<string, string> = {
    READ_REPO_CONTEXT: "Read project context",
    PREPARE_PATCH: "Prepare safe patch",
    VALIDATE_PATCH: "Validate patch",
    VERIFY_BUILD: "Verify build",
    GENERATE_REPORT: "Write report",
    REQUEST_APPROVAL: "Request approval",
    BLOCKED_EXTERNAL_DEPENDENCY: "Requires approval before execution",
  };
  return labels[stageType] ?? stageType.replace(/_/g, " ").toLowerCase();
}

function stageExplanation(stageType: string | null): string {
  if (!stageType) {
    return "AI-E has no active workflow step right now.";
  }
  const explanations: Record<string, string> = {
    READ_REPO_CONTEXT: "AI-E is reviewing project information before generating results.",
    PREPARE_PATCH: "AI-E is preparing a scoped change plan that still respects approval rules.",
    VALIDATE_PATCH: "AI-E is waiting to verify the workflow result before it can be counted as complete.",
    VERIFY_BUILD: "AI-E is preparing a bounded verification step for the requested work.",
    GENERATE_REPORT: "AI-E is turning the workflow outcome into an operator-readable report.",
    REQUEST_APPROVAL: "AI-E is waiting for a human decision before a sensitive step can continue.",
    BLOCKED_EXTERNAL_DEPENDENCY: "AI-E stopped because this request needs approval or another external route before execution can continue.",
  };
  return explanations[stageType] ?? "AI-E is tracking this workflow step under supervised rules.";
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: "Waiting",
    RUNNING: "Running",
    PARTIALLY_COMPLETED: "In progress",
    COMPLETED: "Done",
    BLOCKED: "Needs attention",
    FAILED: "Failed",
    ROLLBACK_AVAILABLE: "Rollback available",
    PAUSED: "Paused",
    INTERRUPTED: "Interrupted",
    RESUMABLE: "Ready to resume",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

function statusExplanation(status: string): string {
  const explanations: Record<string, string> = {
    PENDING: "This workflow is ready, but the current step has not started yet.",
    RUNNING: "AI-E is working through a supervised step and has not claimed completion yet.",
    PARTIALLY_COMPLETED: "Some steps are complete, and AI-E is waiting for the next safe operator action.",
    COMPLETED: "All planned workflow steps have completed inside the supervised workflow model.",
    BLOCKED: "AI-E stopped because approval, validation, scope, or an external dependency is missing.",
    FAILED: "A workflow step failed and needs operator review before continuing.",
    ROLLBACK_AVAILABLE: "AI-E prepared an undo path for operator review; it did not run rollback automatically.",
    PAUSED: "The workflow was intentionally paused and can be reviewed for continuation.",
    INTERRUPTED: "The workflow stopped unexpectedly and needs review before it can resume.",
    RESUMABLE: "This workflow can safely continue from the previous recorded step.",
  };
  return explanations[status] ?? "AI-E is tracking this workflow state under supervised rules.";
}

function firstPendingApproval(workflow: EliteAgentWorkflowSession): EliteAgentWorkflowStage | null {
  return workflow.stages.find((stage) => stage.approvalState === "PENDING") ?? null;
}

function approvalActionStage(workflow: EliteAgentWorkflowSession): EliteAgentWorkflowStage | null {
  return workflow.stages.find((stage, index) => stage.approvalState === "PENDING" && workflow.stages.slice(0, index).every((previous) => previous.lifecycleState === "COMPLETED")) ?? null;
}

function firstPendingValidation(workflow: EliteAgentWorkflowSession): EliteAgentWorkflowStage | null {
  return workflow.stages.find((stage) => stage.validationRequired && stage.validationState === "PENDING" && stage.lifecycleState === "RUNNING") ?? null;
}

function currentStage(workflow: EliteAgentWorkflowSession): EliteAgentWorkflowStage | null {
  return workflow.stages.find((stage) => stage.stageId === workflow.currentStageId) ?? workflow.stages.find((stage) => stage.lifecycleState !== "COMPLETED") ?? null;
}

function buildWorkflow(prompt: string): EliteAgentWorkflowSession {
  const sessionSeed = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  return buildEliteAgentWorkflowSession({
    agentId: `${sampleAgent.agentId}-workflow-${sessionSeed}`,
    prompt,
    allowedPaths: sampleAgent.allowedPaths,
    forbiddenPaths: sampleAgent.blockedPaths,
  });
}

function workflowAssistantSummary(workflow: EliteAgentWorkflowSession): string {
  const summary = summarizeEliteAgentWorkflow(workflow);
  const recoveryGuidance = buildEliteAgentBlockedWorkflowRecoveryGuidance(workflow);
  const stage = currentStage(workflow);
  const isReadOnly = workflow.stages.every((entry) => entry.mutationPermission !== "MUTATION_REQUIRES_APPROVAL");
  const approval = firstPendingApproval(workflow);
  if (summary.status === "BLOCKED") {
    return `${recoveryGuidance?.blockedExplanation ?? `This workflow is blocked before it can continue. ${summary.blockedStageReason ?? "A governance requirement or external dependency is missing."}`} Safe next step: ${recoveryGuidance?.safeAlternative ?? "Resolve the blocker before continuing."}`;
  }
  if (summary.status === "COMPLETED") {
    return `This workflow completed all ${workflow.stages.length} planned steps. Review the summary or start another workflow.`;
  }
  if (summary.resumeEligible) {
    return `This workflow is ready to resume from ${stageLabel(summary.resumeFromStage ?? summary.currentStage)} while keeping the same approval and validation rules.`;
  }
  if (approval) {
    return `This workflow includes ${stageLabel(approval.type).toLowerCase()}. Approval is required before mutation-capable work can continue.`;
  }
  if (isReadOnly) {
    return `This workflow is using read-only analysis steps. No approval is currently required.`;
  }
  return `This workflow is operating on ${stageLabel(stage?.type ?? null).toLowerCase()} with supervised approval and validation checks available as needed.`;
}

function workflowCreationSummary(workflow: EliteAgentWorkflowSession): string {
  const summary = summarizeEliteAgentWorkflow(workflow);
  if (summary.status === "BLOCKED") {
    return "AI-E Agent created a supervised blocked workflow so the missing approval or external route is visible before execution continues.";
  }
  if (firstPendingApproval(workflow)) {
    return "AI-E Agent created a supervised workflow with an approval checkpoint before mutation-capable work can begin.";
  }
  if (summary.validationCheckpoints.length > 0) {
    return "AI-E Agent created a supervised verification workflow with validation guidance.";
  }
  return "AI-E Agent created a supervised inspection workflow.";
}

function nextRecommendedAction(workflow: EliteAgentWorkflowSession): string {
  const summary = summarizeEliteAgentWorkflow(workflow);
  const recoveryGuidance = buildEliteAgentBlockedWorkflowRecoveryGuidance(workflow);
  const stage = currentStage(workflow);
  if (summary.status === "COMPLETED") {
    return "Inspect results, start another workflow, or review technical details.";
  }
  if (summary.resumeEligible) {
    return `Resume the workflow from ${stageLabel(summary.resumeFromStage ?? summary.currentStage).toLowerCase()}.`;
  }
  if (summary.status === "BLOCKED") {
    return recoveryGuidance?.suggestedRecovery ?? "Review the blocker and resolve the missing dependency before continuing.";
  }
  const approvedMutationStage = workflow.stages.find((entry) => entry.approvalState === "APPROVED" && entry.mutationPermission === "MUTATION_REQUIRES_APPROVAL" && entry.lifecycleState !== "COMPLETED");
  if (approvedMutationStage) {
    return stage?.stageId === approvedMutationStage.stageId ? "Run the approved step." : "Complete earlier supervised steps, then run the approved step.";
  }
  if (firstPendingValidation(workflow)) {
    return "Run validation to verify the workflow result.";
  }
  if (stage?.approvalState === "APPROVED" && stage.mutationPermission === "MUTATION_REQUIRES_APPROVAL") {
    return "Run the approved step.";
  }
  if (stage?.lifecycleState === "VALIDATING") {
    return "Wait for validation evidence, then record the validation result.";
  }
  if (summary.status === "RUNNING") {
    return `Wait for ${stageLabel(summary.currentStage).toLowerCase()} to complete.`;
  }
  return "Run the current step to continue.";
}

function latestWorkflowEvent(workflow: EliteAgentWorkflowSession): string {
  const latestApproval = workflow.approvalEvents.at(-1);
  const latestLog = workflow.logs.at(-1);
  if (latestApproval?.approvalGateState === "APPROVED_BY_OPERATOR") {
    return "Approval recorded. The next action is to run the approved step.";
  }
  if (latestApproval?.approvalGateState === "APPROVAL_DENIED") {
    return "Approval denied. The workflow remains safely stopped.";
  }
  if (latestLog?.message) {
    return latestLog.message;
  }
  return "Workflow created. Follow the highlighted next action to move forward.";
}

function activeStageStatus(workflow: EliteAgentWorkflowSession, stage: EliteAgentWorkflowStage | null): string {
  if (!stage) {
    return workflow.status === "COMPLETED" ? "Workflow complete" : "No active step";
  }
  if (workflow.status === "BLOCKED") {
    return "Stopped for operator review";
  }
  if (stage.approvalState === "PENDING" && stage.mutationPermission === "MUTATION_REQUIRES_APPROVAL") {
    return "Waiting for operator approval";
  }
  if (stage.approvalState === "APPROVED" && stage.lifecycleState === "PENDING") {
    return "Approved and ready to run";
  }
  if (stage.lifecycleState === "RUNNING") {
    return "Current step is running";
  }
  if (stage.lifecycleState === "VALIDATING") {
    return "Waiting for validation evidence";
  }
  if (stage.lifecycleState === "PENDING") {
    return workflow.completedStageCount > 0 ? "Ready for the next workflow step" : "Ready to start";
  }
  return statusLabel(stage.lifecycleState);
}

function runStepButtonLabel(workflow: EliteAgentWorkflowSession): string {
  const summary = summarizeEliteAgentWorkflow(workflow);
  const stage = currentStage(workflow);
  if (summary.status === "COMPLETED") {
    return "Workflow Complete";
  }
  if (summary.status === "BLOCKED") {
    return "Workflow Blocked";
  }
  if (summary.resumeEligible) {
    return "Resume Workflow";
  }
  if (!stage) {
    return "No Step Available";
  }
  if (stage.lifecycleState === "RUNNING") {
    return "Current Step Running";
  }
  if (stage.lifecycleState === "VALIDATING") {
    return "Validation In Progress";
  }
  if (stage.approvalState === "APPROVED" && stage.mutationPermission === "MUTATION_REQUIRES_APPROVAL") {
    return "Run Approved Step";
  }
  return "Run Current Step";
}

function resumeUnavailableReason(workflow: EliteAgentWorkflowSession): string | null {
  const summary = summarizeEliteAgentWorkflow(workflow);
  if (summary.resumeEligible) {
    return null;
  }
  if (summary.status === "COMPLETED") {
    return "Resume is unavailable because this workflow is already complete.";
  }
  if (summary.status === "BLOCKED") {
    return "Resume becomes available after the blocker is resolved and the workflow is marked resumable.";
  }
  const pendingValidation = workflow.stages.find((stage) => stage.validationRequired && stage.validationState === "PENDING");
  if (pendingValidation) {
    return "Resume becomes available after validation is handled or the workflow is saved for resume.";
  }
  return "Resume becomes available after the workflow is paused and saved for later continuation.";
}

function primaryActionLabel(workflow: EliteAgentWorkflowSession): string {
  const summary = summarizeEliteAgentWorkflow(workflow);
  const recoveryGuidance = buildEliteAgentBlockedWorkflowRecoveryGuidance(workflow);
  if (summary.resumeEligible) {
    return "Resume Workflow";
  }
  if (buildEliteAgentApprovalGateGuidance(workflow)?.approvalGateState === "WAITING_FOR_APPROVAL") {
    return "Approve This Step";
  }
  if (firstPendingValidation(workflow)) {
    return "Run Validation";
  }
  if (summary.status === "BLOCKED") {
    return recoveryGuidance?.actions[0]?.label ?? "Explain Blocker";
  }
  if (summary.status === "COMPLETED") {
    return "Inspect Summary";
  }
  if (summary.status === "RUNNING") {
    return "Mark Current Step Complete";
  }
  return runStepButtonLabel(workflow);
}

function StageTimeline({ workflow }: { workflow: EliteAgentWorkflowSession }) {
  const active = currentStage(workflow);
  return (
    <ol className="mt-4 grid gap-2 sm:grid-cols-3">
      {workflow.stages.map((stage) => {
        const isComplete = stage.lifecycleState === "COMPLETED";
        const isActive = active?.stageId === stage.stageId && workflow.status !== "COMPLETED";
        const stateLabel = isComplete ? "Complete" : isActive ? "Active" : "Locked";
        const classes = isComplete
          ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-300/40 dark:bg-emerald-400/10 dark:text-emerald-100"
          : isActive
            ? "border-cyan-400 bg-cyan-50 text-cyan-950 ring-2 ring-cyan-400/20 dark:border-cyan-300/60 dark:bg-cyan-400/10 dark:text-cyan-100"
            : "border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400";
        return (
        <li key={stage.stageId} className={`rounded-md border px-3 py-2 text-xs ${classes}`}>
          <span className="block font-semibold uppercase tracking-[0.12em]">{stateLabel}</span>
          <span className="mt-1 block font-semibold text-sm normal-case tracking-normal">{stageLabel(stage.type)}</span>
          <span className="mt-1 block">{statusLabel(stage.lifecycleState)}</span>
        </li>
        );
      })}
    </ol>
  );
}

function CurrentWorkflowStepPanel({ workflow, feedback }: { workflow: EliteAgentWorkflowSession; feedback?: string }) {
  const stage = currentStage(workflow);
  return (
    <div data-current-step-panel className="mt-3 rounded-md border border-cyan-300 bg-cyan-50 p-4 shadow-sm dark:border-cyan-300/30 dark:bg-cyan-400/10">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-100">Current Workflow Step</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div>
          <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-200">Current Step</p>
          <p className="mt-1 text-sm font-semibold text-cyan-950 dark:text-cyan-100">{stageLabel(stage?.type ?? null)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-200">Status</p>
          <p className="mt-1 text-sm font-semibold text-cyan-950 dark:text-cyan-100">{activeStageStatus(workflow, stage)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-200">Next</p>
          <p className="mt-1 text-sm font-semibold text-cyan-950 dark:text-cyan-100">{nextRecommendedAction(workflow)}</p>
        </div>
      </div>
      <p className="mt-3 rounded-md border border-cyan-200 bg-white p-3 text-sm leading-6 text-cyan-950 dark:border-cyan-200/20 dark:bg-[#070b12] dark:text-cyan-100"><span className="font-semibold">What just happened:</span> {feedback ?? latestWorkflowEvent(workflow)}</p>
    </div>
  );
}

function ActionButton({ label, onClick, disabled, primary }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  const classes = primary
    ? "rounded-md bg-cyan-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:bg-cyan-500 dark:text-[#061018] dark:hover:bg-cyan-400 dark:disabled:bg-white/10 dark:disabled:text-zinc-500"
    : "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:border-cyan-400 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-white/10 dark:bg-[#111827] dark:text-zinc-100 dark:hover:border-cyan-300/60 dark:hover:bg-cyan-400/10 dark:disabled:bg-white/5 dark:disabled:text-zinc-500";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={classes}
    >
      {label}
    </button>
  );
}

function blockerExplanation(workflow: EliteAgentWorkflowSession): string {
  const guidance = buildEliteAgentBlockedWorkflowRecoveryGuidance(workflow);
  if (!guidance) {
    return "This workflow is not currently blocked.";
  }
  return `${guidance.blockedExplanation} Safety rule: ${guidance.safetyRuleTriggered} Safe alternative: ${guidance.safeAlternative} Before proceeding: ${guidance.beforeProceeding}`;
}

function approvalGateLabel(guidance: EliteAgentApprovalGateGuidance): string {
  const labels: Record<EliteAgentApprovalGateGuidance["approvalGateState"], string> = {
    APPROVAL_REQUIRED: "Approval required",
    WAITING_FOR_APPROVAL: "Waiting for approval",
    APPROVED_BY_OPERATOR: "Approved by operator",
    APPROVAL_DENIED: "Approval denied",
  };
  return labels[guidance.approvalGateState];
}

function approvalRiskExplanation(guidance: EliteAgentApprovalGateGuidance): string {
  return `Approval is required because ${guidance.whyApprovalRequired} Risk: ${guidance.whatCouldGoWrong} Allowed: ${guidance.allowedToDo} Not allowed: ${guidance.notAllowedToDo} Validation afterward: ${guidance.validationAfterward}`;
}

export function EliteAgentClient() {
  const workflowCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [result, setResult] = useState<LiteEliteRunResult | null>(null);
  const [workflows, setWorkflows] = useState<EliteAgentWorkflowSession[]>([]);
  const [historyStore, setHistoryStore] = useState<AgentWorkflowHistoryStore>(() => createAgentWorkflowHistoryStore());
  const [workflowPrompt, setWorkflowPrompt] = useState(examplePrompts[0] ?? "inspect the inventory system");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [summaryWorkflowId, setSummaryWorkflowId] = useState<string | null>(null);
  const [workflowFeedback, setWorkflowFeedback] = useState<Record<string, string>>({});
  const [pendingFocusWorkflowId, setPendingFocusWorkflowId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState("Ask for a workflow and I will plan the next supervised steps without pretending to have unrestricted execution.");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingFocusWorkflowId) {
      return;
    }
    const target = workflowCardRefs.current[pendingFocusWorkflowId];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
      setPendingFocusWorkflowId(null);
    }
  }, [pendingFocusWorkflowId, workflows]);

  function upsertWorkflow(workflow: EliteAgentWorkflowSession, feedback?: string) {
    setWorkflows((current) => [workflow, ...current.filter((entry) => entry.workflowSessionId !== workflow.workflowSessionId)]);
    setHistoryStore((current) => recordAgentWorkflowHistory(current, workflow));
    setSelectedWorkflowId(workflow.workflowSessionId);
    setPendingFocusWorkflowId(workflow.workflowSessionId);
    if (feedback) {
      setWorkflowFeedback((current) => ({ ...current, [workflow.workflowSessionId]: feedback }));
    }
  }

  function submitWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = workflowPrompt.trim();
    if (!prompt) {
      return;
    }
    const workflow = buildWorkflow(prompt);
    const feedback = `${workflowCreationSummary(workflow)} Next action: ${nextRecommendedAction(workflow)}`;
    upsertWorkflow(workflow, feedback);
    setAgentReply(`${workflowCreationSummary(workflow)} Next recommended action: ${nextRecommendedAction(workflow)}`);
  }

  async function runSampleTask() {
    setIsRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/operator/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: sampleAgent, task: sampleTask }),
      });
      const payload = await response.json() as { ok: boolean; result?: LiteEliteRunResult; error?: string };
      if (!payload.ok || !payload.result) {
        throw new Error(payload.error ?? "Agent run failed.");
      }
      setResult(payload.result);
      setAgentReply("The bounded sample task ran inside its scoped path and reported verification results. No broader execution authority was added.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Agent run failed.");
    } finally {
      setIsRunning(false);
    }
  }

  function runWorkflow(workflow: EliteAgentWorkflowSession) {
    const stage = currentStage(workflow);
    if (!stage) {
      setAgentReply("This workflow has no runnable stage left.");
      return;
    }
    try {
      const next = advanceEliteAgentWorkflow(workflow, { stageId: stage.stageId, action: "START_STAGE" });
      const feedback = `${stageLabel(stage.type)} started. This is the current supervised step; it has not completed yet.`;
      upsertWorkflow(next, feedback);
      setAgentReply(`${feedback} Next recommended action: ${nextRecommendedAction(next)}`);
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "The workflow could not start safely.");
    }
  }

  function resumeWorkflow(workflow: EliteAgentWorkflowSession) {
    try {
      const next = resumeEliteAgentWorkflow(workflow);
      const feedback = `Resumed from ${stageLabel(summarizeEliteAgentWorkflow(next).currentStage)}. Approval and validation rules still apply.`;
      upsertWorkflow(next, feedback);
      setAgentReply(`${feedback} Next recommended action: ${nextRecommendedAction(next)}`);
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "This workflow is not currently resumable.");
    }
  }

  function approveThisStep(workflow: EliteAgentWorkflowSession) {
    const guidance = buildEliteAgentApprovalGateGuidance(workflow);
    if (!guidance || guidance.approvalGateState !== "WAITING_FOR_APPROVAL") {
      setAgentReply("No approval-ready stage is waiting for operator approval right now.");
      return;
    }
    try {
      const next = advanceEliteAgentWorkflow(workflow, { stageId: guidance.stageId, action: "APPROVE_STAGE", reason: "Operator approved this supervised stage only from the Approval Required panel." });
      const feedback = "Approval recorded. The next action is to run the approved step.";
      upsertWorkflow(next, feedback);
      setAgentReply(`${feedback} AI-E will not apply files automatically. Next recommended action: ${nextRecommendedAction(next)}`);
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "Approval could not be recorded for this step.");
    }
  }

  function denyApproval(workflow: EliteAgentWorkflowSession) {
    const guidance = buildEliteAgentApprovalGateGuidance(workflow);
    if (!guidance || guidance.approvalGateState !== "WAITING_FOR_APPROVAL") {
      setAgentReply("No approval-ready stage is waiting for denial right now.");
      return;
    }
    try {
      const next = advanceEliteAgentWorkflow(workflow, { stageId: guidance.stageId, action: "DENY_STAGE_APPROVAL", reason: "Approval denied by operator from the Approval Required panel." });
      const feedback = `${stageLabel(guidance.workflowStage)} approval was denied. The workflow remains safely stopped.`;
      upsertWorkflow(next, feedback);
      setAgentReply(`${feedback} No mutation or execution was performed.`);
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "Approval denial could not be recorded for this step.");
    }
  }

  function reviewApprovalScope(workflow: EliteAgentWorkflowSession) {
    const guidance = buildEliteAgentApprovalGateGuidance(workflow);
    if (!guidance) {
      setAgentReply("No approval scope is available for this workflow right now.");
      return;
    }
    setAgentReply(`Approval scope review: action ${guidance.actionBeingApproved}; stage ${stageLabel(guidance.workflowStage)}; allowed paths ${guidance.allowedPathScope.join(", ") || "none"}; mutation permission ${guidance.mutationPermission}; validation ${guidance.validationRequirement}; rollback ${guidance.rollbackAvailability}.`);
  }

  function explainApprovalRisk(workflow: EliteAgentWorkflowSession) {
    const guidance = buildEliteAgentApprovalGateGuidance(workflow);
    if (!guidance) {
      setAgentReply("No approval risk explanation is available for this workflow right now.");
      return;
    }
    setAgentReply(approvalRiskExplanation(guidance));
  }

  function runValidation(workflow: EliteAgentWorkflowSession) {
    const stage = firstPendingValidation(workflow);
    if (!stage) {
      setAgentReply("Validation is not available yet. Start the validation-required step first.");
      return;
    }
    try {
      const next = advanceEliteAgentWorkflow(workflow, { stageId: stage.stageId, action: "BEGIN_VALIDATION", reason: "Operator opened validation from the workflow guidance card." });
      const feedback = `${stageLabel(stage.type)} is waiting for validation evidence.`;
      upsertWorkflow(next, feedback);
      setAgentReply(`${feedback} Next recommended action: ${nextRecommendedAction(next)}`);
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "Validation could not begin for this workflow.");
    }
  }

  function recordValidationPass(workflow: EliteAgentWorkflowSession) {
    const stage = workflow.stages.find((entry) => entry.lifecycleState === "VALIDATING" && entry.validationState === "PENDING");
    if (!stage) {
      setAgentReply("No validating step is waiting for a result right now.");
      return;
    }
    try {
      const next = markEliteAgentWorkflowValidation(workflow, { stageId: stage.stageId, validationState: "SUCCESS", reason: "Operator recorded validation evidence as passed from the guidance card." });
      const feedback = `Validation passed for ${stageLabel(stage.type)}.`;
      upsertWorkflow(next, feedback);
      setAgentReply(`${feedback} Next recommended action: ${nextRecommendedAction(next)}`);
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "Validation result could not be recorded.");
    }
  }

  function completeCurrentStep(workflow: EliteAgentWorkflowSession) {
    const stage = currentStage(workflow);
    if (!stage) {
      setAgentReply("This workflow has no step available to complete.");
      return;
    }
    try {
      const next = advanceEliteAgentWorkflow(workflow, { stageId: stage.stageId, action: "COMPLETE_STAGE", reason: "Operator completed the current guided workflow step." });
      const feedback = next.status === "COMPLETED"
        ? "Workflow completed. You can inspect results or start another workflow."
        : `${stageLabel(stage.type)} completed. Next step: ${stageLabel(summarizeEliteAgentWorkflow(next).currentStage).toLowerCase()}.`;
      upsertWorkflow(next, feedback);
      setAgentReply(`${feedback} Next recommended action: ${nextRecommendedAction(next)}`);
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "The current step could not be completed safely.");
    }
  }

  function saveForResume(workflow: EliteAgentWorkflowSession) {
    const stage = currentStage(workflow);
    if (!stage) {
      setAgentReply("This workflow has no active step to save for resume.");
      return;
    }
    try {
      const paused = advanceEliteAgentWorkflow(workflow, { stageId: stage.stageId, action: "PAUSE_WORKFLOW", reason: "Operator saved this workflow for later continuation." });
      const resumable = advanceEliteAgentWorkflow(paused, { stageId: stage.stageId, action: "MARK_RESUMABLE", reason: "This workflow can safely resume from the saved step." });
      const feedback = `Saved ${stageLabel(stage.type)} for later continuation.`;
      upsertWorkflow(resumable, feedback);
      setAgentReply(`${feedback} Next recommended action: ${nextRecommendedAction(resumable)}`);
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "This workflow could not be saved for resume.");
    }
  }

  function handleRecoveryAction(workflow: EliteAgentWorkflowSession, actionId: EliteAgentBlockedWorkflowRecoveryActionId) {
    const guidance = buildEliteAgentBlockedWorkflowRecoveryGuidance(workflow);
    if (!guidance) {
      setAgentReply("This workflow is not blocked, so no recovery path is needed right now.");
      return;
    }
    if (actionId === "PREPARE_SAFE_PATCH_INSTEAD" || actionId === "CONVERT_TO_SAFE_PLANNING_WORKFLOW") {
      const safeWorkflow = convertBlockedWorkflowToSafePatchPreparation(workflow, { now: new Date().toISOString() });
      const feedback = "Created a safe patch preparation workflow. Automatic application remains blocked, and no patch was applied.";
      upsertWorkflow(safeWorkflow, feedback);
      setAgentReply(`${feedback} Next recommended action: ${nextRecommendedAction(safeWorkflow)}`);
      return;
    }
    if (actionId === "REQUEST_APPROVAL") {
      setAgentReply(`${guidance.beforeProceeding} Approval must be recorded through an approved operator route before any mutation-capable application can continue. Automatic execution remains blocked here.`);
      return;
    }
    if (actionId === "SHOW_REQUIRED_RUNTIME") {
      setAgentReply(`${guidance.safetyRuleTriggered} Required route: ${guidance.beforeProceeding}`);
      return;
    }
    if (actionId === "REVIEW_SCOPE") {
      setAgentReply(`Review scope before continuing. Allowed paths: ${workflow.allowedPaths.join(", ") || "none"}. Blocked paths: ${workflow.forbiddenPaths.join(", ") || "none"}. ${guidance.beforeProceeding}`);
      return;
    }
    setAgentReply(blockerExplanation(workflow));
  }

  const latestRun = result?.summary;
  const recentHistory = listRecentAgentWorkflows(historyStore, 4);
  const failedHistory = listFailedAgentWorkflows(historyStore);
  const resumableHistory = listResumableAgentWorkflows(historyStore);
  const selectedWorkflow = workflows.find((workflow) => workflow.workflowSessionId === selectedWorkflowId) ?? workflows[0] ?? null;

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-4 py-6 text-slate-950 dark:bg-[#070b12] dark:text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420] dark:shadow-black/30">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-200">AI-E Agents</p>
          <h1 className="mt-2 text-3xl font-semibold">Ask an AI-E Agent to manage a workflow</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-zinc-300">
            Start with a plain request. AI-E will turn it into a supervised workflow, show the next step, and keep advanced governance details available when you need them.
          </p>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
            <form onSubmit={submitWorkflow} className="space-y-4">
              <label className="block text-sm font-semibold" htmlFor="workflow-prompt">Ask an AI-E Agent to help with a workflow</label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="workflow-prompt"
                  value={workflowPrompt}
                  onChange={(event) => setWorkflowPrompt(event.target.value)}
                  placeholder="inspect the inventory system"
                  className="min-h-11 flex-1 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-white/10 dark:bg-[#070b12] dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
                <button type="submit" className="rounded-md bg-cyan-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-600 dark:bg-cyan-500 dark:text-[#061018] dark:hover:bg-cyan-400">Start Workflow</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {examplePrompts.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => setWorkflowPrompt(prompt)} className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-cyan-400 hover:bg-cyan-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-cyan-300/60">
                    {prompt}
                  </button>
                ))}
              </div>
            </form>
            <div className="mt-4 rounded-md border border-cyan-200 bg-cyan-50 p-4 text-sm leading-6 text-cyan-950 dark:border-cyan-300/20 dark:bg-cyan-400/10 dark:text-cyan-100">
              {agentReply}
            </div>
          </div>

          <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
            <h2 className="text-lg font-semibold">Control Center</h2>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Active</p><p className="text-2xl font-semibold">{workflows.length}</p></div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Resumable</p><p className="text-2xl font-semibold">{resumableHistory.length}</p></div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Blocked</p><p className="text-2xl font-semibold">{failedHistory.length}</p></div>
            </div>
            <button type="button" onClick={runSampleTask} disabled={isRunning} className="mt-4 w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-cyan-400 hover:bg-cyan-50 disabled:opacity-50 dark:border-white/10 dark:bg-[#111827] dark:text-zinc-100 dark:hover:border-cyan-300/60">
              {isRunning ? "Running bounded task..." : "Run Scoped Sample Task"}
            </button>
            {error && <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-300/30 dark:bg-rose-400/10 dark:text-rose-100">{error}</p>}
          </aside>
        </section>

        {workflows.length === 0 ? (
          <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm dark:border-white/15 dark:bg-[#0d1420]">
            <h2 className="text-xl font-semibold">No workflows yet.</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-zinc-300">Try one of these: inspect the inventory system, prepare a safe movement patch, verify latest gameplay patch.</p>
            <div className="mx-auto mt-5 max-w-2xl rounded-md border border-cyan-200 bg-cyan-50 p-4 text-left dark:border-cyan-300/20 dark:bg-cyan-400/10">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-100">Next Recommended Action</p>
              <p className="mt-2 text-sm text-cyan-950 dark:text-cyan-100">Start a workflow using the input above.</p>
            </div>
          </section>
        ) : (
          <section className="grid gap-4 lg:grid-cols-2">
            {workflows.map((workflow) => {
              const summary = summarizeEliteAgentWorkflow(workflow);
              const recoveryGuidance = buildEliteAgentBlockedWorkflowRecoveryGuidance(workflow);
              const approvalGuidance = buildEliteAgentApprovalGateGuidance(workflow);
              const isSelected = selectedWorkflow?.workflowSessionId === workflow.workflowSessionId;
              const showSummary = summaryWorkflowId === workflow.workflowSessionId;
              const canResume = summary.resumeEligible;
              const activeStage = currentStage(workflow);
              const needsApproval = Boolean(approvalActionStage(workflow));
              const pendingValidation = firstPendingValidation(workflow);
              const validatingStage = workflow.stages.find((stage) => stage.lifecycleState === "VALIDATING" && stage.validationState === "PENDING");
              const resumeReason = resumeUnavailableReason(workflow);
              const primary = primaryActionLabel(workflow);
              const runLabel = runStepButtonLabel(workflow);
              const runDisabled = !activeStage || summary.status === "COMPLETED" || summary.status === "BLOCKED" || activeStage.lifecycleState === "RUNNING" || activeStage.lifecycleState === "VALIDATING" || summary.resumeEligible;
              return (
                <article
                  key={workflow.workflowSessionId}
                  ref={(element) => { workflowCardRefs.current[workflow.workflowSessionId] = element; }}
                  tabIndex={-1}
                  className={`scroll-mt-6 rounded-lg border bg-white p-5 shadow-sm outline-none transition focus:ring-2 focus:ring-cyan-400/30 dark:bg-[#0d1420] ${isSelected ? "border-cyan-400 ring-2 ring-cyan-400/20 dark:border-cyan-300/60" : "border-slate-200 dark:border-white/10"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">{workflow.prompt}</h2>
                      <p className="mt-1 text-sm text-slate-600 dark:text-zinc-300">Current step: {stageLabel(summary.currentStage)}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-zinc-400">{stageExplanation(summary.currentStage)}</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${statusClass(summary.status.toLowerCase())}`}>{statusLabel(summary.status)}</span>
                  </div>

                  <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-zinc-400">AI-E Agent Summary</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-200">{workflowAssistantSummary(workflow)}</p>
                  </div>

                  <CurrentWorkflowStepPanel workflow={workflow} feedback={workflowFeedback[workflow.workflowSessionId]} />

                  <div className="mt-3 rounded-md border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-300/20 dark:bg-cyan-400/10">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-100">Next Recommended Action</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-cyan-950 dark:text-cyan-100">{nextRecommendedAction(workflow)}</p>
                  </div>

                  <p className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600 dark:border-white/10 dark:bg-[#070b12] dark:text-zinc-300">{statusExplanation(summary.status)}</p>

                  <StageTimeline workflow={workflow} />

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Validation</p><p className="mt-1 text-sm font-semibold">{summary.validationCheckpoints[0]?.validationState.replace(/_/g, " ") ?? "Not required"}</p></div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Approval</p><p className="mt-1 text-sm font-semibold">{summary.approvalCheckpoints[0]?.approvalState.replace(/_/g, " ") ?? "Not required"}</p></div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Rollback</p><p className="mt-1 text-sm font-semibold">{summary.rollbackAvailable ? "Available" : "Not needed"}</p></div>
                  </div>

                  {summary.blockedStageReason && (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100">{summary.blockedStageReason}</p>
                  )}

                  {recoveryGuidance && (
                    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-300/30 dark:bg-emerald-400/10">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800 dark:text-emerald-100">{recoveryGuidance.title}</p>
                      <div className="mt-3 space-y-2 text-sm leading-6 text-emerald-950 dark:text-emerald-100">
                        <p><span className="font-semibold">Why blocked:</span> {recoveryGuidance.blockedExplanation}</p>
                        <p><span className="font-semibold">Safe next step:</span> {recoveryGuidance.safeAlternative}</p>
                        <p><span className="font-semibold">Before proceeding:</span> {recoveryGuidance.beforeProceeding}</p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {recoveryGuidance.actions.map((action) => (
                          <ActionButton key={action.id} label={action.label} onClick={() => handleRecoveryAction(workflow, action.id)} primary={primary === action.label} />
                        ))}
                      </div>
                      <details className="mt-3 text-sm text-emerald-950 dark:text-emerald-100">
                        <summary className="cursor-pointer font-semibold">Recovery Technical Details</summary>
                        <p className="mt-2 leading-6">Safety rule: {recoveryGuidance.safetyRuleTriggered}</p>
                        <p className="mt-1 leading-6">{recoveryGuidance.technicalDetail}</p>
                      </details>
                    </div>
                  )}

                  {approvalGuidance && !recoveryGuidance && (
                    <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 p-4 dark:border-violet-300/30 dark:bg-violet-400/10">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-800 dark:text-violet-100">{approvalGuidance.title}</p>
                        <span className="rounded-full border border-violet-300 px-2 py-1 text-xs font-semibold text-violet-900 dark:border-violet-200/40 dark:text-violet-100">{approvalGateLabel(approvalGuidance)}</span>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm leading-6 text-violet-950 dark:text-violet-100 sm:grid-cols-2">
                        <p><span className="font-semibold">Action being approved:</span> {approvalGuidance.actionBeingApproved}</p>
                        <p><span className="font-semibold">Workflow stage:</span> {stageLabel(approvalGuidance.workflowStage)}</p>
                        <p><span className="font-semibold">Allowed path scope:</span> {approvalGuidance.allowedPathScope.join(", ") || "none"}</p>
                        <p><span className="font-semibold">Mutation permission:</span> {approvalGuidance.mutationPermission}</p>
                        <p><span className="font-semibold">Validation requirement:</span> {approvalGuidance.validationRequirement}</p>
                        <p><span className="font-semibold">Rollback availability:</span> {approvalGuidance.rollbackAvailability}</p>
                        <p><span className="font-semibold">Risk level:</span> {approvalGuidance.riskLevel}</p>
                        <p><span className="font-semibold">After approval:</span> {approvalGuidance.whatHappensAfterApproval}</p>
                      </div>
                      <p className="mt-3 rounded-md border border-violet-200 bg-white p-3 text-sm leading-6 text-violet-950 dark:border-violet-200/20 dark:bg-[#070b12] dark:text-violet-100">You are approving this step only. AI-E will not apply files automatically.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ActionButton label="Approve This Step" onClick={() => approveThisStep(workflow)} primary={primary === "Approve This Step"} disabled={approvalGuidance.approvalGateState !== "WAITING_FOR_APPROVAL"} />
                        <ActionButton label="Deny Approval" onClick={() => denyApproval(workflow)} disabled={approvalGuidance.approvalGateState !== "WAITING_FOR_APPROVAL"} />
                        <ActionButton label="Review Scope" onClick={() => reviewApprovalScope(workflow)} />
                        <ActionButton label="Explain Risk" onClick={() => explainApprovalRisk(workflow)} />
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {summary.status !== "COMPLETED" && !canResume && <ActionButton label={runLabel} onClick={() => runWorkflow(workflow)} primary={!runDisabled && primary === runLabel} disabled={runDisabled} />}
                    <ActionButton label="Resume Workflow" onClick={() => resumeWorkflow(workflow)} disabled={!canResume} primary={primary === "Resume Workflow"} />
                    {pendingValidation && <ActionButton label="Run Validation" onClick={() => runValidation(workflow)} primary={primary === "Run Validation"} />}
                    {validatingStage && <ActionButton label="Record Validation Pass" onClick={() => recordValidationPass(workflow)} primary />}
                    {summary.status === "RUNNING" && !pendingValidation && !validatingStage && <ActionButton label="Mark Current Step Complete" onClick={() => completeCurrentStep(workflow)} primary={primary === "Mark Current Step Complete"} />}
                    {!canResume && summary.status !== "COMPLETED" && summary.status !== "BLOCKED" && <ActionButton label="Save for Resume" onClick={() => saveForResume(workflow)} />}
                    <ActionButton label="Inspect" onClick={() => setSelectedWorkflowId(workflow.workflowSessionId)} />
                    <ActionButton label={showSummary ? "Hide Summary" : "Inspect Summary"} onClick={() => setSummaryWorkflowId(showSummary ? null : workflow.workflowSessionId)} primary={primary === "Inspect Summary"} />
                    {summary.blockedStageReason && !recoveryGuidance && <ActionButton label="Explain Blocker" onClick={() => setAgentReply(blockerExplanation(workflow))} primary={primary === "Explain Blocker"} />}
                    {needsApproval && !approvalGuidance && <ActionButton label="Approve This Step" onClick={() => approveThisStep(workflow)} primary={primary === "Approve This Step"} />}
                  </div>

                  {resumeReason && <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-zinc-400">{resumeReason}</p>}

                  {summary.status === "RUNNING" && !pendingValidation && !validatingStage && (
                    <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">Mark Current Step Complete records that the current supervised step finished. It does not mean the entire workflow is complete.</p>
                  )}

                  {summary.status === "COMPLETED" && (
                    <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-300/30 dark:bg-emerald-400/10">
                      <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Workflow Completed</p>
                      <p className="mt-2 text-sm leading-6 text-emerald-800 dark:text-emerald-100">Next options: inspect results, start another workflow, or review technical details.</p>
                    </div>
                  )}

                  {showSummary && (
                    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-white/10 dark:bg-[#070b12] dark:text-zinc-300">
                      <p>{workflow.deterministicSelectionReason}</p>
                      <p className="mt-2">Completed {summary.completedStageCount} of {workflow.stages.length} steps. Remaining work stays inside supervised approval and validation rules.</p>
                    </div>
                  )}

                  <details className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-white/10 dark:bg-[#070b12]">
                    <summary className="cursor-pointer font-semibold">Show Technical Details</summary>
                    <div className="mt-3 space-y-3 text-xs leading-5 text-slate-600 dark:text-zinc-300">
                      <p>Workflow ID: {workflow.workflowSessionId}</p>
                      <p>Allowed path: {workflow.allowedPaths.join(", ")}</p>
                      <ol className="space-y-2">
                        {workflow.stages.map((item) => (
                          <li key={item.stageId} className="rounded border border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-white/5">
                            {item.type}: {item.lifecycleState}; approval {item.approvalState}; validation {item.validationState}; mutation {item.mutationPermission}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </details>
                </article>
              );
            })}
          </section>
        )}

        {recentHistory.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
            <h2 className="text-lg font-semibold">Recent Workflow History</h2>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {recentHistory.map((entry) => {
                const operationalSummary = summarizeAgentWorkflowHistory(entry);
                return (
                  <article key={entry.historyId} className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-semibold">{entry.purpose}</h3>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(entry.status.toLowerCase())}`}>{statusLabel(entry.status)}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-zinc-300">{operationalSummary.resumeGuidance}</p>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <details className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
          <summary className="cursor-pointer text-lg font-semibold">Advanced Governance Reference</summary>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {workflowStageDefinitions.map((definition) => (
              <article key={definition.type} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-white/10 dark:bg-white/5">
                <h3 className="font-semibold">{stageLabel(definition.type)}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-zinc-300">Mutation: {definition.mutationPermission}; Validation required: {String(definition.validationRequired)}; Rollback support: {String(definition.rollbackSupported)}; External dependency: {String(definition.externalDependencyRequired)}</p>
              </article>
            ))}
          </div>
        </details>

        {latestRun && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Latest Scoped Task Run</h2>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${statusClass(latestRun.status)}`}>{latestRun.status}</span>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div><h3 className="font-semibold">Changed Files</h3><p className="mt-1 text-sm text-slate-600 dark:text-zinc-300">{latestRun.filesChanged.length ? latestRun.filesChanged.join(", ") : "none"}</p></div>
              <div><h3 className="font-semibold">Verification</h3><p className="mt-1 text-sm text-slate-600 dark:text-zinc-300">{latestRun.commandsRun.map((command) => `${command.command}: ${command.skipped ? "skipped" : command.exitCode}`).join(", ") || "none"}</p></div>
            </div>
            <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700 dark:border-white/10 dark:bg-[#070b12] dark:text-zinc-300">{latestRun.truthfulCapabilityBoundary}</p>
          </section>
        )}
      </div>
    </main>
  );
}
