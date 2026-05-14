"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { LiteEliteRunResult } from "@/lib/aie/liteEliteAgentRuntime";
import { mediateAgentWorkflowPrompt, type AgentWorkflowMediationDecision, type AgentWorkflowVisibility } from "@/lib/aie/agentWorkflowMediation";
import {
  appendBoundedConversationTurn,
  buildContinuityMemoryCard,
  buildSystemImprovementRequest,
  createAgentConversationTurn,
  formatAgentConversationTranscript,
  formatContinuityMemoryCard,
  formatSystemImprovementRequest,
  isSystemImprovementRequestPrompt,
  shouldOfferContinuityMemoryCard,
  type AgentConversationTurn,
  type AgentConversationTurnKind,
  type ContinuityMemoryCard,
} from "@/lib/aie/agentConversationLifecycle";
import {
  advanceEliteAgentWorkflow,
  buildEliteAgentApprovalGateGuidance,
  buildEliteAgentBlockedWorkflowRecoveryGuidance,
  buildEliteAgentWorkflowSession,
  convertBlockedWorkflowToSafePatchPreparation,
  isEliteAgentWorkflowStageAutoAdvancable,
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

const defaultOptionalPaths = [
  "Ask a follow-up in plain language",
  "Learn the current milestone",
  "Choose a concrete system to inspect when ready",
  "Prepare a governed workflow for a concrete task",
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

function isSimulationWorkflowPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return /\b(dummy|demo|simulate|simulated|simulation|tutorial)\b.*\b(workflow|progress|completion|lifecycle)\b|\b(progress\s+bar|completion\s+state|ux\s+test)\b/.test(normalized);
}

function isSimulationWorkflow(workflow: EliteAgentWorkflowSession): boolean {
  return isSimulationWorkflowPrompt(workflow.prompt);
}

function currentStage(workflow: EliteAgentWorkflowSession): EliteAgentWorkflowStage | null {
  return workflow.stages.find((stage) => stage.stageId === workflow.currentStageId) ?? workflow.stages.find((stage) => stage.lifecycleState !== "COMPLETED") ?? null;
}

function buildWorkflow(prompt: string): EliteAgentWorkflowSession {
  const sessionSeed = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  const workflow = buildEliteAgentWorkflowSession({
    agentId: `${sampleAgent.agentId}-workflow-${sessionSeed}`,
    prompt,
    allowedPaths: sampleAgent.allowedPaths,
    forbiddenPaths: sampleAgent.blockedPaths,
  });
  if (!isSimulationWorkflowPrompt(prompt)) {
    return workflow;
  }
  return {
    ...workflow,
    deterministicSelectionReason: `${workflow.deterministicSelectionReason} This is a simulation-aware demo workflow for UX pacing and completion-state testing; it does not execute repo, shell, Unity, or mutation work.`,
    truthfulCapabilityBoundary: `${workflow.truthfulCapabilityBoundary} Demo workflow progression is simulated UI behavior only and does not relax governance for real operational workflows.`,
  };
}

function workflowAssistantSummary(workflow: EliteAgentWorkflowSession): string {
  const summary = summarizeEliteAgentWorkflow(workflow);
  const recoveryGuidance = buildEliteAgentBlockedWorkflowRecoveryGuidance(workflow);
  const stage = currentStage(workflow);
  const isReadOnly = workflow.stages.every((entry) => entry.mutationPermission !== "MUTATION_REQUIRES_APPROVAL");
  const approval = firstPendingApproval(workflow);
  if (isSimulationWorkflow(workflow)) {
    if (summary.status === "COMPLETED") {
      return `This demo workflow reached 100% and arrived at the completion state. It simulated lifecycle pacing only; no repo, shell, Unity, or mutation work ran.`;
    }
    return `This is a simulation-aware demo workflow. It will advance through staged progress automatically so the operator can test pacing, percent movement, and completion arrival without real execution.`;
  }
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
    if (approval.type === "REQUEST_APPROVAL" && approval.order === 0) {
      return `This workflow is waiting for scoped session approval before AI-E works inside ${workflowPurposeSentence(workflow)}.`;
    }
    return `This workflow includes ${stageLabel(approval.type).toLowerCase()}. Approval is required before mutation-capable work can continue.`;
  }
  if (isReadOnly) {
    return `This workflow is using read-only analysis steps. No approval is currently required.`;
  }
  return `This workflow is operating on ${stageLabel(stage?.type ?? null).toLowerCase()} with supervised approval and validation checks available as needed.`;
}

function workflowCreationSummary(workflow: EliteAgentWorkflowSession): string {
  const summary = summarizeEliteAgentWorkflow(workflow);
  if (isSimulationWorkflow(workflow)) {
    return "AI-E Agent created a simulation-aware demo workflow for progress-bar and completion-state testing.";
  }
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
  if (isSimulationWorkflow(workflow)) {
    return "Watch the simulated workflow progress; AI-E will advance this demo automatically.";
  }
  if (buildEliteAgentApprovalGateGuidance(workflow)?.approvalGateState === "WAITING_FOR_APPROVAL") {
    return "Review the approval scope, then approve or deny the human-gated step.";
  }
  if (isEliteAgentWorkflowStageAutoAdvancable(stage)) {
    return `AI-E is auto-progressing ${stageLabel(stage?.type ?? null).toLowerCase()}; it will pause when human judgment is required.`;
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
  if (stage.approvalState === "PENDING") {
    return "Waiting for operator approval";
  }
  if (stage.approvalState === "APPROVED" && stage.lifecycleState === "PENDING") {
    return "Approved and ready to run";
  }
  if (stage.lifecycleState === "RUNNING") {
    return "Current step is running";
  }
  if (stage.lifecycleState === "VALIDATING") {
    if (isSimulationWorkflow(workflow)) {
      return "Simulating validation pulse";
    }
    return "Waiting for validation evidence";
  }
  if (stage.lifecycleState === "PENDING") {
    return workflow.completedStageCount > 0 ? "Ready for the next workflow step" : "Ready to start";
  }
  return statusLabel(stage.lifecycleState);
}

function workflowProgress(workflow: EliteAgentWorkflowSession): {
  completed: number;
  total: number;
  percent: number;
  currentStepNumber: number;
  remaining: number;
  label: string;
  expectation: string;
} {
  const total = Math.max(workflow.stages.length, 1);
  const completed = workflow.status === "COMPLETED" ? total : workflow.stages.filter((stage) => stage.lifecycleState === "COMPLETED").length;
  const active = currentStage(workflow);
  const currentStepNumber = workflow.status === "COMPLETED"
    ? total
    : active
      ? Math.min(active.order + 1, total)
      : Math.min(completed + 1, total);
  const percent = Math.min(100, Math.max(0, Math.round((completed / total) * 100)));
  const remaining = Math.max(total - completed, 0);
  const label = workflow.status === "COMPLETED"
    ? "Workflow complete"
    : `Step ${currentStepNumber} of ${total}`;
  const expectation = workflow.status === "COMPLETED"
    ? "All planned workflow steps are finished."
    : isSimulationWorkflow(workflow)
      ? "Demo progression is auto-paced for UX testing; no real execution or validation evidence is required."
    : remaining === 1
      ? "One supervised step remains, plus any required approval or validation pause."
      : `${remaining} supervised steps remain, plus any required approval or validation pauses.`;
  return { completed, total, percent, currentStepNumber, remaining, label, expectation };
}

function workflowCompletionReport(workflow: EliteAgentWorkflowSession): string {
  const progress = workflowProgress(workflow);
  const summary = summarizeEliteAgentWorkflow(workflow);
  return [
    `Workflow: ${workflow.prompt}`,
    `Status: ${statusLabel(summary.status)}`,
    `Progress: ${progress.completed} of ${progress.total} steps (${progress.percent}%)`,
    `Completed stages: ${workflow.stages.filter((stage) => stage.lifecycleState === "COMPLETED").map((stage) => stageLabel(stage.type)).join(", ") || "none"}`,
    `Next action: ${nextRecommendedAction(workflow)}`,
  ].join("\n");
}

function workflowPurposeSentence(workflow: EliteAgentWorkflowSession): string {
  return workflow.prompt.replace(/[.!?]+$/g, "").trim();
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
  if (stage.approvalState === "PENDING") {
    return "Approval Required";
  }
  if (isEliteAgentWorkflowStageAutoAdvancable(stage)) {
    return "Auto Progressing";
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
  if (isEliteAgentWorkflowStageAutoAdvancable(currentStage(workflow))) {
    return "Auto Progressing";
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

function WorkflowProgressPanel({ workflow }: { workflow: EliteAgentWorkflowSession }) {
  const progress = workflowProgress(workflow);
  const isComplete = workflow.status === "COMPLETED";
  return (
    <div className={`sticky top-2 z-10 mt-4 rounded-md border p-4 shadow-sm ${isComplete ? "border-emerald-200 bg-emerald-50 dark:border-emerald-300/30 dark:bg-emerald-400/10" : "border-sky-200 bg-sky-50 dark:border-sky-300/30 dark:bg-sky-400/10"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${isComplete ? "text-emerald-800 dark:text-emerald-100" : "text-sky-800 dark:text-sky-100"}`}>Workflow Progress</p>
          <p className={`mt-1 text-lg font-semibold ${isComplete ? "text-emerald-950 dark:text-emerald-100" : "text-sky-950 dark:text-sky-100"}`}>{isComplete ? "Workflow Complete" : progress.label}</p>
        </div>
        <div className={`rounded-full border bg-white px-3 py-1 text-sm font-semibold ${isComplete ? "border-emerald-200 text-emerald-800 dark:border-emerald-300/30 dark:bg-[#070b12] dark:text-emerald-100" : "border-sky-200 text-sky-800 dark:border-sky-300/20 dark:bg-[#070b12] dark:text-sky-100"}`}>{progress.percent}%</div>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-white dark:bg-[#070b12]" aria-label={`Workflow progress ${progress.percent}%`}>
        <div className={`h-full rounded-full transition-all ${isComplete ? "bg-emerald-500" : "bg-sky-500"}`} style={{ width: `${progress.percent}%` }} />
      </div>
      <div className={`mt-3 grid gap-2 text-sm sm:grid-cols-3 ${isComplete ? "text-emerald-900 dark:text-emerald-100" : "text-sky-900 dark:text-sky-100"}`}>
        <p><span className="font-semibold">Completed:</span> {progress.completed} of {progress.total}</p>
        <p><span className="font-semibold">Remaining:</span> {progress.remaining}</p>
        <p><span className="font-semibold">Current:</span> {isComplete ? "Final state" : stageLabel(currentStage(workflow)?.type ?? null)}</p>
      </div>
      <p className={`mt-2 text-xs leading-5 ${isComplete ? "text-emerald-800 dark:text-emerald-100" : "text-sky-800 dark:text-sky-100"}`}>{progress.expectation}</p>
    </div>
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

function isConversationalMediation(decision: AgentWorkflowMediationDecision | null): boolean {
  return Boolean(decision && !decision.shouldCreateWorkflow && decision.workflowVisibility === "hidden");
}

function isReflectiveAuthenticityPath(actions: string[]): boolean {
  return actions.includes("Challenge the premise") && actions.includes("Name what would make it feel more real");
}

function conversationalPathReply(decision: AgentWorkflowMediationDecision): string {
  if (decision.suggestedActions.length === 0 || isReflectiveAuthenticityPath(decision.suggestedActions)) {
    return decision.assistantMessage;
  }
  return `${decision.assistantMessage} From here: ${decision.suggestedActions.join("; ")}. You can pick one, or ask in your own words.`;
}

function conversationKindFromMediation(decision: AgentWorkflowMediationDecision): AgentConversationTurnKind {
  if (decision.interactionLevel === "LIGHTWEIGHT_GUIDED_WORKFLOW") {
    return "GUIDED_EXPLORATION";
  }
  if (decision.interactionLevel === "FULL_SUPERVISED_OPERATIONAL") {
    return "SUPERVISED_WORKFLOW";
  }
  return "CONVERSATIONAL";
}

export function EliteAgentClient() {
  const workflowCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollConversationRef = useRef(true);
  const simulationWorkflowTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const autoWorkflowTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const advanceSimulationWorkflowRef = useRef<(workflow: EliteAgentWorkflowSession) => void>(() => undefined);
  const advanceAutoWorkflowRef = useRef<(workflow: EliteAgentWorkflowSession) => void>(() => undefined);
  const [result, setResult] = useState<LiteEliteRunResult | null>(null);
  const [workflows, setWorkflows] = useState<EliteAgentWorkflowSession[]>([]);
  const [historyStore, setHistoryStore] = useState<AgentWorkflowHistoryStore>(() => createAgentWorkflowHistoryStore());
  const [workflowPrompt, setWorkflowPrompt] = useState(examplePrompts[0] ?? "inspect the inventory system");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [summaryWorkflowId, setSummaryWorkflowId] = useState<string | null>(null);
  const [workflowFeedback, setWorkflowFeedback] = useState<Record<string, string>>({});
  const [workflowVisibility, setWorkflowVisibility] = useState<Record<string, AgentWorkflowVisibility>>({});
  const [expandedWorkflowDetails, setExpandedWorkflowDetails] = useState<Record<string, boolean>>({});
  const [pendingFocusWorkflowId, setPendingFocusWorkflowId] = useState<string | null>(null);
  const [lastMediationDecision, setLastMediationDecision] = useState<AgentWorkflowMediationDecision | null>(null);
  const [conversationTurns, setConversationTurns] = useState<AgentConversationTurn[]>([]);
  const [continuityMemoryCard, setContinuityMemoryCard] = useState<ContinuityMemoryCard | null>(null);
  const [continuityMemoryCardDraft, setContinuityMemoryCardDraft] = useState("");
  const [showContinuityEditor, setShowContinuityEditor] = useState(false);
  const [continuityOfferDismissed, setContinuityOfferDismissed] = useState(false);
  const [agentReply, setAgentReply] = useState("Ask in plain language. AI-E can discuss the system, suggest optional paths, or prepare a governed workflow when the task calls for one.");
  const [copyConversationStatus, setCopyConversationStatus] = useState<string | null>(null);
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

  useEffect(() => {
    return () => {
      Object.values(simulationWorkflowTimersRef.current).forEach((timer) => clearTimeout(timer));
      simulationWorkflowTimersRef.current = {};
      Object.values(autoWorkflowTimersRef.current).forEach((timer) => clearTimeout(timer));
      autoWorkflowTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const activeSimulationIds = new Set(
      workflows
        .filter((workflow) => isSimulationWorkflow(workflow) && workflow.status !== "COMPLETED" && workflow.status !== "BLOCKED")
        .map((workflow) => workflow.workflowSessionId),
    );
    for (const [workflowId, timer] of Object.entries(simulationWorkflowTimersRef.current)) {
      if (!activeSimulationIds.has(workflowId)) {
        clearTimeout(timer);
        delete simulationWorkflowTimersRef.current[workflowId];
      }
    }
    for (const workflow of workflows) {
      if (!activeSimulationIds.has(workflow.workflowSessionId) || simulationWorkflowTimersRef.current[workflow.workflowSessionId]) {
        continue;
      }
      simulationWorkflowTimersRef.current[workflow.workflowSessionId] = setTimeout(() => {
        delete simulationWorkflowTimersRef.current[workflow.workflowSessionId];
        advanceSimulationWorkflowRef.current(workflow);
      }, 1000);
    }
  }, [workflows]);

  useEffect(() => {
    const activeAutoIds = new Set(
      workflows
        .filter((workflow) => {
          if (isSimulationWorkflow(workflow) || workflow.status === "COMPLETED" || workflow.status === "BLOCKED") {
            return false;
          }
          return isEliteAgentWorkflowStageAutoAdvancable(currentStage(workflow));
        })
        .map((workflow) => workflow.workflowSessionId),
    );
    for (const [workflowId, timer] of Object.entries(autoWorkflowTimersRef.current)) {
      if (!activeAutoIds.has(workflowId)) {
        clearTimeout(timer);
        delete autoWorkflowTimersRef.current[workflowId];
      }
    }
    for (const workflow of workflows) {
      if (!activeAutoIds.has(workflow.workflowSessionId) || autoWorkflowTimersRef.current[workflow.workflowSessionId]) {
        continue;
      }
      autoWorkflowTimersRef.current[workflow.workflowSessionId] = setTimeout(() => {
        delete autoWorkflowTimersRef.current[workflow.workflowSessionId];
        advanceAutoWorkflowRef.current(workflow);
      }, 850);
    }
  }, [workflows]);

  useEffect(() => {
    if (!shouldAutoScrollConversationRef.current) {
      return;
    }
    const scrollToLatestTurn = () => {
      const container = conversationScrollRef.current;
      if (!container) {
        return;
      }
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    };
    const animationFrame = requestAnimationFrame(() => {
      scrollToLatestTurn();
      window.setTimeout(scrollToLatestTurn, 80);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [conversationTurns.length]);

  function handleConversationScroll() {
    const container = conversationScrollRef.current;
    if (!container) {
      shouldAutoScrollConversationRef.current = true;
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollConversationRef.current = distanceFromBottom < 96;
  }

  function upsertWorkflow(workflow: EliteAgentWorkflowSession, feedback?: string, visibility: AgentWorkflowVisibility = "full") {
    setWorkflows((current) => [workflow, ...current.filter((entry) => entry.workflowSessionId !== workflow.workflowSessionId)]);
    setHistoryStore((current) => recordAgentWorkflowHistory(current, workflow));
    setSelectedWorkflowId(workflow.workflowSessionId);
    setPendingFocusWorkflowId(workflow.workflowSessionId);
    setWorkflowVisibility((current) => ({ ...current, [workflow.workflowSessionId]: current[workflow.workflowSessionId] ?? visibility }));
    if (feedback) {
      setWorkflowFeedback((current) => ({ ...current, [workflow.workflowSessionId]: feedback }));
    }
  }

  function toggleWorkflowDetails(workflowId: string) {
    setExpandedWorkflowDetails((current) => ({ ...current, [workflowId]: !current[workflowId] }));
    setPendingFocusWorkflowId(workflowId);
  }

  function recordConversationTurn(prompt: string, response: string, kind: AgentConversationTurnKind) {
    const turn = createAgentConversationTurn({ prompt, response, kind });
    setConversationTurns((current) => appendBoundedConversationTurn(current, turn));
    setCopyConversationStatus(null);
  }

  async function copyConversation() {
    if (conversationTurns.length === 0) {
      return;
    }
    const transcript = formatAgentConversationTranscript(conversationTurns);
    try {
      await navigator.clipboard.writeText(transcript);
      setCopyConversationStatus("Conversation copied.");
    } catch {
      setCopyConversationStatus("Copy was not available in this browser session.");
    }
  }

  async function copyWorkflowReport(workflow: EliteAgentWorkflowSession) {
    try {
      await navigator.clipboard.writeText(workflowCompletionReport(workflow));
      setAgentReply("Workflow report copied. You can paste it into a handoff, review, or follow-up conversation.");
    } catch {
      setAgentReply("Copy report was not available in this browser session.");
    }
  }

  function createContinuityMemoryCard(reviewFirst = true) {
    const card = buildContinuityMemoryCard(conversationTurns);
    setContinuityMemoryCard(card);
    setContinuityMemoryCardDraft(formatContinuityMemoryCard(card));
    setShowContinuityEditor(reviewFirst);
    setContinuityOfferDismissed(false);
    setAgentReply("I prepared a Continuity Memory Card for review. It preserves the useful working state for a faster continuation; it does not claim to remember every word perfectly.");
  }

  function saveContinuityMemoryCardDraft() {
    setShowContinuityEditor(false);
    setAgentReply("Continuity Memory Card saved in this session. It can seed a fresh conversation with the current working state, without pretending to preserve every word.");
  }

  function startFreshFromContinuityCard() {
    const card = continuityMemoryCard ?? buildContinuityMemoryCard(conversationTurns);
    const draft = continuityMemoryCardDraft || formatContinuityMemoryCard(card);
    setContinuityMemoryCard(card);
    setContinuityMemoryCardDraft(draft);
    setConversationTurns([
      createAgentConversationTurn({
        prompt: "Start fresh from this progress.",
        response: "A fresh active conversation started from the saved Continuity Memory Card. The card preserves useful working state, not a perfect transcript.",
        kind: "SYSTEM",
      }),
    ]);
    setShowContinuityEditor(false);
    setContinuityOfferDismissed(false);
    setAgentReply("Started a fresh active conversation from the Continuity Memory Card. The previous long session is represented by the reviewed card.");
  }

  function submitWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = workflowPrompt.trim();
    if (!prompt) {
      return;
    }
    if (isSystemImprovementRequestPrompt(prompt)) {
      const request = buildSystemImprovementRequest({ prompt, turns: conversationTurns });
      const response = formatSystemImprovementRequest(request);
      setLastMediationDecision(null);
      setAgentReply(response);
      recordConversationTurn(prompt, response, "SYSTEM_IMPROVEMENT_REQUEST");
      setSelectedWorkflowId(null);
      return;
    }
    const mediation = mediateAgentWorkflowPrompt(prompt, { recentTurns: conversationTurns });
    setLastMediationDecision(mediation);
    if (!mediation.shouldCreateWorkflow) {
      const response = conversationalPathReply(mediation);
      setAgentReply(response);
      recordConversationTurn(prompt, response, conversationKindFromMediation(mediation));
      setSelectedWorkflowId(null);
      return;
    }
    const workflow = buildWorkflow(prompt);
    const feedback = mediation.workflowVisibility === "minimal"
      ? mediation.assistantMessage
      : `${workflowCreationSummary(workflow)} Next action: ${nextRecommendedAction(workflow)}`;
    upsertWorkflow(workflow, feedback, mediation.workflowVisibility);
    const response = `${mediation.assistantMessage} Next recommended action: ${nextRecommendedAction(workflow)}`;
    setAgentReply(response);
    recordConversationTurn(prompt, response, conversationKindFromMediation(mediation));
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

  function advanceSimulationWorkflow(workflow: EliteAgentWorkflowSession) {
    const stage = currentStage(workflow);
    if (!stage || workflow.status === "COMPLETED" || workflow.status === "BLOCKED") {
      return;
    }
    try {
      if (stage.lifecycleState === "PENDING") {
        const next = advanceEliteAgentWorkflow(workflow, { stageId: stage.stageId, action: "START_STAGE", reason: "Simulation demo auto-started the next workflow stage for UX pacing." });
        const feedback = `Demo progression started ${stageLabel(stage.type).toLowerCase()}. This is simulated lifecycle movement only.`;
        upsertWorkflow(next, feedback, workflowVisibility[workflow.workflowSessionId] ?? "full");
        setAgentReply(`${feedback} Next recommended action: ${nextRecommendedAction(next)}`);
        return;
      }
      if (stage.lifecycleState === "RUNNING" && stage.validationRequired) {
        const next = advanceEliteAgentWorkflow(workflow, { stageId: stage.stageId, action: "BEGIN_VALIDATION", reason: "Simulation demo opened a validation pulse without requiring external evidence." });
        const feedback = `Demo progression is simulating validation for ${stageLabel(stage.type).toLowerCase()}.`;
        upsertWorkflow(next, feedback, workflowVisibility[workflow.workflowSessionId] ?? "full");
        setAgentReply(`${feedback} Next recommended action: ${nextRecommendedAction(next)}`);
        return;
      }
      if (stage.lifecycleState === "RUNNING") {
        const next = advanceEliteAgentWorkflow(workflow, { stageId: stage.stageId, action: "COMPLETE_STAGE", reason: "Simulation demo completed this step for UX pacing." });
        const feedback = next.status === "COMPLETED"
          ? `Demo workflow complete. AI-E reached the completion state for ${workflowPurposeSentence(workflow)}.`
          : `Demo progression completed ${stageLabel(stage.type).toLowerCase()}. Overall progress is ${workflowProgress(next).percent}%.`;
        upsertWorkflow(next, feedback, workflowVisibility[workflow.workflowSessionId] ?? "full");
        setAgentReply(next.status === "COMPLETED" ? `${feedback} You can inspect the summary, copy the report, or ask what felt static.` : `${feedback} Next recommended action: ${nextRecommendedAction(next)}`);
        return;
      }
      if (stage.lifecycleState === "VALIDATING") {
        const validated = markEliteAgentWorkflowValidation(workflow, { stageId: stage.stageId, validationState: "SUCCESS", reason: "Simulation demo recorded synthetic validation evidence for UX testing only." });
        const next = advanceEliteAgentWorkflow(validated, { stageId: stage.stageId, action: "COMPLETE_STAGE", reason: "Simulation demo completed the validated stage for UX pacing." });
        const feedback = next.status === "COMPLETED"
          ? `Demo workflow complete. AI-E reached the completion state for ${workflowPurposeSentence(workflow)}.`
          : `Simulated validation passed for ${stageLabel(stage.type).toLowerCase()}. Overall progress is ${workflowProgress(next).percent}%.`;
        upsertWorkflow(next, feedback, workflowVisibility[workflow.workflowSessionId] ?? "full");
        setAgentReply(next.status === "COMPLETED" ? `${feedback} You can inspect the summary, copy the report, or ask what felt static.` : `${feedback} Next recommended action: ${nextRecommendedAction(next)}`);
      }
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "The simulated workflow could not advance safely.");
    }
  }

  advanceSimulationWorkflowRef.current = advanceSimulationWorkflow;

  function advanceAutoWorkflow(workflow: EliteAgentWorkflowSession) {
    const stage = currentStage(workflow);
    if (!isEliteAgentWorkflowStageAutoAdvancable(stage) || !stage) {
      return;
    }
    try {
      if (stage.lifecycleState === "PENDING") {
        const next = advanceEliteAgentWorkflow(workflow, { stageId: stage.stageId, action: "START_STAGE", reason: "AI-E auto-started this low-risk internal workflow stage; no operator judgment was required." });
        const feedback = `AI-E started ${stageLabel(stage.type).toLowerCase()} automatically because it is non-mutating and does not require external validation.`;
        upsertWorkflow(next, feedback, workflowVisibility[workflow.workflowSessionId] ?? "full");
        setAgentReply(`${feedback} Next recommended action: ${nextRecommendedAction(next)}`);
        return;
      }
      if (stage.lifecycleState === "RUNNING") {
        const next = advanceEliteAgentWorkflow(workflow, { stageId: stage.stageId, action: "COMPLETE_STAGE", reason: "AI-E auto-completed this low-risk internal workflow stage; no operator judgment was required." });
        const feedback = next.status === "COMPLETED"
          ? `Workflow complete. AI-E finished ${workflowPurposeSentence(workflow)} without requiring extra confirmation for internal steps.`
          : `AI-E completed ${stageLabel(stage.type).toLowerCase()} automatically. Overall progress is ${workflowProgress(next).percent}%.`;
        upsertWorkflow(next, feedback, workflowVisibility[workflow.workflowSessionId] ?? "full");
        setAgentReply(next.status === "COMPLETED" ? `${feedback} You can inspect the summary, copy the report, or ask a follow-up.` : `${feedback} Next recommended action: ${nextRecommendedAction(next)}`);
      }
    } catch (caught) {
      setAgentReply(caught instanceof Error ? caught.message : "The workflow could not auto-advance safely.");
    }
  }

  advanceAutoWorkflowRef.current = advanceAutoWorkflow;

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
      const feedback = guidance.actionBeingApproved === "Scoped dev session boundary"
        ? "Scoped dev session approved. AI-E can now progress through in-scope low-risk workflow stages."
        : next.status === "COMPLETED"
        ? "Approval recorded. The approval checkpoint is complete."
        : "Approval recorded. The next action is to run the approved step.";
      upsertWorkflow(next, feedback);
      setAgentReply(next.status === "COMPLETED" ? `${feedback} AI-E did not apply files automatically or claim gameplay validation.` : `${feedback} AI-E will not apply files automatically. Next recommended action: ${nextRecommendedAction(next)}`);
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
      const nextSummary = summarizeEliteAgentWorkflow(next);
      const feedback = next.status === "COMPLETED"
        ? `Workflow complete. AI-E finished ${workflowPurposeSentence(workflow)}.`
        : `${stageLabel(stage.type)} completed. Next step: ${stageLabel(nextSummary.currentStage).toLowerCase()}. Overall progress is ${workflowProgress(next).percent}%.`;
      upsertWorkflow(next, feedback);
      setAgentReply(next.status === "COMPLETED" ? `${feedback} You can inspect the summary, copy the report, ask a follow-up, inspect another system, or prepare a safe patch from findings.` : `${feedback} Next recommended action: ${nextRecommendedAction(next)}`);
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
  const showConversationalPaths = workflows.length === 0 && isConversationalMediation(lastMediationDecision);
  const optionalPaths = showConversationalPaths ? lastMediationDecision?.suggestedActions ?? defaultOptionalPaths : defaultOptionalPaths;
  const showContinuityOffer = shouldOfferContinuityMemoryCard(conversationTurns) && !continuityMemoryCard && !continuityOfferDismissed;

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-4 py-6 text-slate-950 dark:bg-[#070b12] dark:text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420] dark:shadow-black/30">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-200">AI-E Agents</p>
          <h1 className="mt-2 text-3xl font-semibold">Ask an AI-E Agent to guide the next step</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-zinc-300">
            Start with a plain request. AI-E can answer conversationally, suggest optional paths, prepare a safe exploration, or turn concrete operational work into a supervised workflow.
          </p>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="flex min-h-[62vh] flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
            <div className="flex-1 rounded-md border border-cyan-200 bg-cyan-50 p-4 text-sm leading-6 text-cyan-950 dark:border-cyan-300/20 dark:bg-cyan-400/10 dark:text-cyan-100">
              {conversationTurns.length === 0 ? (
                <div className="flex min-h-80 items-center justify-center text-center">
                  <p className="max-w-xl">{agentReply}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-100">Active Conversation</p>
                      <h2 className="mt-1 text-lg font-semibold text-cyan-950 dark:text-cyan-100">Stacked Conversation History</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-cyan-200 bg-white px-3 py-1 text-xs font-semibold text-cyan-800 dark:border-cyan-300/20 dark:bg-[#070b12] dark:text-cyan-100">{conversationTurns.length} active turns</span>
                      <button type="button" onClick={copyConversation} className="rounded-md border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-50 dark:border-cyan-300/30 dark:bg-[#070b12] dark:text-cyan-100 dark:hover:bg-cyan-400/10">Copy Conversation</button>
                    </div>
                  </div>
                  <div ref={conversationScrollRef} onScroll={handleConversationScroll} className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">
                    {conversationTurns.map((turn, index) => (
                      <article key={turn.turnId} className="rounded-md border border-cyan-200 bg-white p-4 dark:border-cyan-300/20 dark:bg-[#070b12]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700 dark:text-cyan-200">Turn {index + 1}</p>
                          <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-800 dark:border-cyan-300/20 dark:bg-cyan-400/10 dark:text-cyan-100">{turn.kind.replace(/_/g, " ").toLowerCase()}</span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-slate-950 dark:text-zinc-100">User: {turn.prompt}</p>
                        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700 dark:text-zinc-200">AI-E: {turn.response}</p>
                      </article>
                    ))}
                    <div ref={conversationEndRef} aria-hidden="true" />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs leading-5 text-cyan-800 dark:text-cyan-100">
                    <p>This is bounded active conversation continuity. Workflow cards remain separate operational state below.</p>
                    {copyConversationStatus && <p className="font-semibold">{copyConversationStatus}</p>}
                  </div>
                </div>
              )}
            </div>
            <form onSubmit={submitWorkflow} className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-white/10">
              <label className="block text-sm font-semibold" htmlFor="workflow-prompt">Ask an AI-E Agent</label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="workflow-prompt"
                  value={workflowPrompt}
                  onChange={(event) => setWorkflowPrompt(event.target.value)}
                  placeholder="ask a question or name a system to inspect"
                  className="min-h-11 flex-1 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-white/10 dark:bg-[#070b12] dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
                <button type="submit" className="rounded-md bg-cyan-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-600 dark:bg-cyan-500 dark:text-[#061018] dark:hover:bg-cyan-400">Ask AI-E</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {examplePrompts.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => setWorkflowPrompt(prompt)} className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-cyan-400 hover:bg-cyan-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-cyan-300/60">
                    {prompt}
                  </button>
                ))}
              </div>
            </form>
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

        {conversationTurns.length > 0 && (showContinuityOffer || continuityMemoryCard) && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
            {(showContinuityOffer || continuityMemoryCard) && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-300/30 dark:bg-amber-400/10">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-100">Continuity Memory Card</p>
                <p className="mt-2 text-sm leading-6 text-amber-950 dark:text-amber-100">This conversation is long enough that speed, readability, or context quality may start to degrade. AI-E can preserve the useful working state as a reviewed Continuity Memory Card so a fresh chat stays fast.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionButton label="Create Memory Card" onClick={() => createContinuityMemoryCard(false)} primary={!continuityMemoryCard} />
                  <ActionButton label="Review What Will Be Saved" onClick={() => createContinuityMemoryCard(true)} />
                  <ActionButton label="Edit Memory Card First" onClick={() => { if (!continuityMemoryCard) { createContinuityMemoryCard(true); } else { setShowContinuityEditor(true); } }} />
                  <ActionButton label="Start Fresh From This Progress" onClick={startFreshFromContinuityCard} disabled={!continuityMemoryCard && conversationTurns.length === 0} />
                  <ActionButton label="Keep Chatting For Now" onClick={() => setContinuityOfferDismissed(true)} />
                </div>
                {showContinuityEditor && (
                  <div className="mt-3">
                    <label htmlFor="continuity-memory-card" className="text-sm font-semibold text-amber-950 dark:text-amber-100">Review or edit the card before saving</label>
                    <textarea
                      id="continuity-memory-card"
                      value={continuityMemoryCardDraft}
                      onChange={(event) => setContinuityMemoryCardDraft(event.target.value)}
                      className="mt-2 min-h-72 w-full rounded-md border border-amber-200 bg-white p-3 font-mono text-xs leading-5 text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-amber-300/20 dark:bg-[#070b12] dark:text-zinc-100"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ActionButton label="Save Memory Card" onClick={saveContinuityMemoryCardDraft} primary />
                      <ActionButton label="Hide Editor" onClick={() => setShowContinuityEditor(false)} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {workflows.length === 0 ? (
          <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm dark:border-white/15 dark:bg-[#0d1420]">
            <h2 className="text-xl font-semibold">No workflows yet.</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-zinc-300">
              {showConversationalPaths ? "No workflow is required for this question. You can keep discussing this or choose a concrete system to inspect when ready." : "You can ask a question, choose a safe inspection target, or prepare a governed workflow when you have a concrete task."}
            </p>
            <div className="mx-auto mt-5 max-w-2xl rounded-md border border-cyan-200 bg-cyan-50 p-4 text-left dark:border-cyan-300/20 dark:bg-cyan-400/10">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-100">{showConversationalPaths ? "Optional Next Paths" : "Continue From Here"}</p>
              <ul className="mt-2 space-y-1 text-sm text-cyan-950 dark:text-cyan-100">
                {optionalPaths.map((path) => <li key={path}>{path}</li>)}
              </ul>
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
              const isAutoAdvancingStage = isEliteAgentWorkflowStageAutoAdvancable(activeStage);
              const runDisabled = !activeStage || isAutoAdvancingStage || summary.status === "COMPLETED" || summary.status === "BLOCKED" || activeStage.lifecycleState === "RUNNING" || activeStage.lifecycleState === "VALIDATING" || summary.resumeEligible;
              const visibility = workflowVisibility[workflow.workflowSessionId] ?? "full";
              const showWorkflowRuntime = visibility === "full" || Boolean(expandedWorkflowDetails[workflow.workflowSessionId]);
              const progress = workflowProgress(workflow);
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

                  <WorkflowProgressPanel workflow={workflow} />

                  {isSimulationWorkflow(workflow) && (
                    <div className="mt-4 rounded-md border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-300/20 dark:bg-cyan-400/10">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-100">Simulated Workflow</p>
                      <p className="mt-2 text-sm leading-6 text-cyan-950 dark:text-cyan-100">This demo is auto-paced so you can evaluate workflow movement, progress percentage, and completion arrival. It does not run repo, shell, Unity, mutation, or real validation work.</p>
                    </div>
                  )}

                  {!isSimulationWorkflow(workflow) && isAutoAdvancingStage && (
                    <div className="mt-4 rounded-md border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-300/20 dark:bg-cyan-400/10">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-100">Auto-Advancing Internal Step</p>
                      <p className="mt-2 text-sm leading-6 text-cyan-950 dark:text-cyan-100">AI-E is progressing this low-risk stage automatically. It will pause for approvals, repo writes, destructive actions, external validation, or other decisions that need human judgment.</p>
                    </div>
                  )}

                  <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-zinc-400">AI-E Agent Summary</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-200">{workflowAssistantSummary(workflow)}</p>
                  </div>

                  {visibility === "minimal" && !showWorkflowRuntime && (
                    <div className="mt-3 rounded-md border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-300/20 dark:bg-cyan-400/10">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-100">Guided Exploration</p>
                      <p className="mt-2 text-sm leading-6 text-cyan-950 dark:text-cyan-100">{workflowFeedback[workflow.workflowSessionId] ?? "This is a safe read-only exploration. Runtime details stay minimized until you open them."}</p>
                      <p className="mt-2 text-sm font-semibold text-cyan-950 dark:text-cyan-100">Next: {nextRecommendedAction(workflow)}</p>
                    </div>
                  )}

                  {showWorkflowRuntime && <CurrentWorkflowStepPanel workflow={workflow} feedback={workflowFeedback[workflow.workflowSessionId]} />}

                  <div className="mt-3 rounded-md border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-300/20 dark:bg-cyan-400/10">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800 dark:text-cyan-100">Next Recommended Action</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-cyan-950 dark:text-cyan-100">{nextRecommendedAction(workflow)}</p>
                  </div>

                  {showWorkflowRuntime && <p className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600 dark:border-white/10 dark:bg-[#070b12] dark:text-zinc-300">{statusExplanation(summary.status)}</p>}

                  {summary.status !== "COMPLETED" && (
                    <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">Current step progress is not the same as workflow completion. This workflow is {progress.percent}% complete overall, with {progress.remaining} supervised step{progress.remaining === 1 ? "" : "s"} remaining.</p>
                  )}

                  {showWorkflowRuntime && <StageTimeline workflow={workflow} />}

                  {showWorkflowRuntime && <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Validation</p><p className="mt-1 text-sm font-semibold">{summary.validationCheckpoints[0]?.validationState.replace(/_/g, " ") ?? "Not required"}</p></div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Approval</p><p className="mt-1 text-sm font-semibold">{summary.approvalCheckpoints[0]?.approvalState.replace(/_/g, " ") ?? "Not required"}</p></div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"><p className="text-xs text-slate-500 dark:text-zinc-400">Rollback</p><p className="mt-1 text-sm font-semibold">{summary.rollbackAvailable ? "Available" : "Not needed"}</p></div>
                  </div>}

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
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-800 dark:text-violet-100">{approvalGuidance.actionBeingApproved === "Scoped dev session boundary" ? "Session Scope Approval" : approvalGuidance.title}</p>
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
                      <div className="mt-3 grid gap-2 text-sm leading-6 text-violet-950 dark:text-violet-100 md:grid-cols-2">
                        <p className="rounded-md border border-violet-200 bg-white p-3 dark:border-violet-200/20 dark:bg-[#070b12]"><span className="font-semibold">Allowed inside boundary:</span> {approvalGuidance.allowedToDo}</p>
                        <p className="rounded-md border border-violet-200 bg-white p-3 dark:border-violet-200/20 dark:bg-[#070b12]"><span className="font-semibold">Not allowed:</span> {approvalGuidance.notAllowedToDo}</p>
                      </div>
                      <p className="mt-3 rounded-md border border-violet-200 bg-white p-3 text-sm leading-6 text-violet-950 dark:border-violet-200/20 dark:bg-[#070b12] dark:text-violet-100">You are approving this step only. AI-E will not apply files automatically.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {approvalGuidance.approvalGateState === "WAITING_FOR_APPROVAL" ? (
                          <>
                            <ActionButton label={approvalGuidance.actionBeingApproved === "Scoped dev session boundary" ? "Approve Scoped Session" : "Approve This Step"} onClick={() => approveThisStep(workflow)} primary={primary === "Approve This Step"} />
                            <ActionButton label="Deny Approval" onClick={() => denyApproval(workflow)} />
                          </>
                        ) : (
                          <span className="rounded-md border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-900 dark:border-violet-200/20 dark:bg-[#070b12] dark:text-violet-100">Approval decision recorded as read-only workflow history.</span>
                        )}
                        <ActionButton label="Review Scope" onClick={() => reviewApprovalScope(workflow)} />
                        <ActionButton label="Explain Risk" onClick={() => explainApprovalRisk(workflow)} />
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {summary.status !== "COMPLETED" && !canResume && !needsApproval && <ActionButton label={runLabel} onClick={() => runWorkflow(workflow)} primary={!runDisabled && primary === runLabel} disabled={runDisabled} />}
                    <ActionButton label="Resume Workflow" onClick={() => resumeWorkflow(workflow)} disabled={!canResume} primary={primary === "Resume Workflow"} />
                    {pendingValidation && <ActionButton label="Run Validation" onClick={() => runValidation(workflow)} primary={primary === "Run Validation"} />}
                    {validatingStage && <ActionButton label="Record Validation Pass" onClick={() => recordValidationPass(workflow)} primary />}
                    {summary.status === "RUNNING" && !pendingValidation && !validatingStage && <ActionButton label="Mark Current Step Complete" onClick={() => completeCurrentStep(workflow)} primary={primary === "Mark Current Step Complete"} />}
                    {!canResume && summary.status !== "COMPLETED" && summary.status !== "BLOCKED" && <ActionButton label="Save for Resume" onClick={() => saveForResume(workflow)} />}
                    <ActionButton label="Inspect" onClick={() => setSelectedWorkflowId(workflow.workflowSessionId)} />
                    {visibility === "minimal" && <ActionButton label={showWorkflowRuntime ? "Hide Workflow Details" : "Show Workflow Details"} onClick={() => toggleWorkflowDetails(workflow.workflowSessionId)} />}
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
                      <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Workflow Complete</p>
                      <p className="mt-2 text-sm leading-6 text-emerald-800 dark:text-emerald-100">AI-E finished {workflowPurposeSentence(workflow)}. This is the final workflow state, not just the current step ending.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ActionButton label="View Summary" onClick={() => setSummaryWorkflowId(workflow.workflowSessionId)} primary />
                        <ActionButton label="Copy Report" onClick={() => copyWorkflowReport(workflow)} />
                        <ActionButton label="Ask a Follow-Up" onClick={() => setWorkflowPrompt(`What should I understand from ${workflow.prompt}?`)} />
                        <ActionButton label="Inspect Another System" onClick={() => setWorkflowPrompt("inspect another system safely")} />
                        <ActionButton label="Prepare Safe Patch From Findings" onClick={() => setWorkflowPrompt(`prepare a safe patch from findings in ${workflow.prompt}`)} />
                      </div>
                    </div>
                  )}

                  {showSummary && (
                    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-white/10 dark:bg-[#070b12] dark:text-zinc-300">
                      <p>{workflow.deterministicSelectionReason}</p>
                      <p className="mt-2">Completed {progress.completed} of {progress.total} steps ({progress.percent}%). Remaining work stays inside supervised approval and validation rules.</p>
                    </div>
                  )}

                  {showWorkflowRuntime && <details className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-white/10 dark:bg-[#070b12]">
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
                  </details>}
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
