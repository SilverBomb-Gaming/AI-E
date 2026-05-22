"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import {
  applyOperatorControlAction,
  type OperatorControlAction,
  type SupervisedSessionControlInput,
} from "@/lib/aie/operatorControlSurface";
import type { AutonomousDeliveryPackage, AutonomousReviewPackage, AutonomousWorkItem } from "@/lib/aie/autonomousWorkPlanning";
import {
  extractUnityValidationEvidenceFromDeliveryPackage,
  extractUnityValidationEvidenceFromReviewPackage,
  UnityValidationEvidencePanel,
} from "@/lib/aie/unityValidationEvidenceView";
import type { AgentRuntimeNode } from "@/lib/aie/agentRuntimeRegistry";
import type {
  OperatorDashboardApprovalRequirement,
  OperatorDashboardGovernedRuntimeLane,
  OperatorDashboardBlockedGoal,
  OperatorDashboardGoal,
  OperatorDashboardRecoveryRecommendation,
  OperatorDashboardState,
  OperatorRuntimeObservabilityEvent,
} from "@/lib/aie/operatorDashboardState";
import type { ExecutionChainRecord } from "@/lib/aie/executionChainState";
import type { OperatorRuntimeStateProviderResult } from "@/lib/aie/operatorRuntimeStateContract";
import type { StrategyGoal, StrategyPortfolioScore } from "@/lib/aie/strategyGoalPortfolio";
import {
  GovernedOperationsDashboard,
  createSeededGovernedOperationsDashboardViewModel,
  generateGovernedOperationProposal,
  getCategoryLabel,
  getRuntimeLabel,
  type GovernedOperationProposal,
} from "@/frontend/ui/governed-operations-dashboard";

type ProofDispatchLifecycleState = "idle" | "dispatching" | "completed" | "failed";

type ProofDispatchLifecycleRecord = { state: string; timestamp: string; message?: string };

type ProofDispatchClientResult = {
  outcome: "completed" | "failed" | "timed_out";
  dispatchId: string;
  sandboxId: string;
  proofFilePath: string;
  receiptId: string;
  receiptSandboxPath: string;
  rollbackContract: { rollbackReady: boolean; rollbackMetadata: { changedFiles: string[]; diffSummary: string } };
  authorizationReceipt: { result: { authorized: boolean; reason?: string } };
  lifecycle: ProofDispatchLifecycleRecord[];
  beforeSnapshotFileCount: number;
  afterSnapshotFileCount: number;
  executedAt: string;
  durationMs: number;
  error?: string;
};

type ProofDispatchApiError = { error: string; hint?: string; dispatchEnabled?: false };

// ---- Runtime Adapter Dispatch (EXEC-0052-B) ----------------------------------------

type RuntimeAdapterDispatchLifecycleState = "idle" | "dispatching" | "completed" | "failed";

// ---- Sandbox Patch Dispatch (EXEC-0052-C) ------------------------------------------

type SandboxPatchDispatchLifecycleState = "idle" | "dispatching" | "completed" | "failed";

type SandboxPatchDispatchLifecycleRecord = { state: string; timestamp: string; message?: string };

type SandboxPatchDispatchClientResult = {
  manifestVersion: string;
  outcome: "completed" | "failed" | "timeout" | "rejected";
  dispatchId: string;
  invocationId: string;
  sandboxId: string;
  runtimeType: string;
  adapterId: string;
  adapterVersion: string;
  operationRequest: string;
  patchFilePath: string;
  receiptId: string;
  receiptSandboxPath: string;
  beforeSnapshotFileCount: number;
  afterSnapshotFileCount: number;
  lifecycle: { currentState: string; records: SandboxPatchDispatchLifecycleRecord[] };
  outputCapture: { stdout: string; stderr: string[] };
  rollbackContract: { rollbackReady: boolean; rollbackMetadata?: { changedFiles: string[]; diffSummary: string } };
  executedAt: string;
  durationMs: number;
  error?: string;
};

type SandboxPatchDispatchApiError = { error: string; hint?: string; dispatchEnabled?: false };

type RuntimeAdapterDispatchLifecycleRecord = { state: string; timestamp: string; message?: string };

type RuntimeAdapterDispatchClientResult = {
  manifestVersion: string;
  outcome: "completed" | "failed" | "timeout" | "rejected";
  dispatchId: string;
  invocationId: string;
  sandboxId: string;
  runtimeType: string;
  adapterId: string;
  adapterVersion: string;
  operationRequest: string;
  proofFilePath: string;
  receiptId: string;
  receiptSandboxPath: string;
  beforeSnapshotFileCount: number;
  afterSnapshotFileCount: number;
  lifecycle: { currentState: string; records: RuntimeAdapterDispatchLifecycleRecord[] };
  rollbackContract: { rollbackReady: boolean; rollbackMetadata?: { changedFiles: string[]; diffSummary: string } };
  executedAt: string;
  durationMs: number;
  error?: string;
};

type RuntimeAdapterDispatchApiError = { error: string; hint?: string; dispatchEnabled?: false };

function ToggleInput({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (nextValue: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm text-ink">
      <span className="text-xs uppercase tracking-[0.18em] text-slate">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border border-ink/10"
      />
    </label>
  );
}

function ReviewQueueRow({
  reviewId,
  title,
  summary,
  status,
  severity,
  onApprove,
  onReject,
  onDefer,
  disabled,
}: {
  reviewId: string;
  title: string;
  summary: string;
  status: string;
  severity: string;
  onApprove: () => void;
  onReject: () => void;
  onDefer: () => void;
  disabled: boolean;
}) {
  return (
    <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="headline text-lg font-semibold text-ink">{title}</h3>
            <StatusBadge status={severity} />
            <StatusBadge status={status} />
          </div>
          <p className="text-sm leading-7 body-muted">{summary}</p>
          <p className="text-xs text-slate">Review id: {reviewId}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton label="Approve Review" onClick={onApprove} disabled={disabled} tone="accent" />
          <ActionButton label="Reject Review" onClick={onReject} disabled={disabled} tone="warning" />
          <ActionButton label="Defer Review" onClick={onDefer} disabled={disabled} />
        </div>
      </div>
    </article>
  );
}

function SupervisedSessionField({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate">{label}</p>
      <p className="mt-2 text-sm leading-7 body-muted">{value}</p>
    </article>
  );
}

function SessionInput({
  label,
  value,
  onChange,
  type = "number",
}: {
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  type?: "number" | "text";
}) {
  return (
    <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm text-ink">
      <span className="text-xs uppercase tracking-[0.18em] text-slate">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none"
      />
    </label>
  );
}

function getStatusClassName(status: string): string {
  if (/completed|ready/i.test(status)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (/paused|approval/i.test(status)) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (/blocked|failed/i.test(status)) {
    return "border-coral/20 bg-coral/10 text-ember";
  }

  if (/running|selected|queue/i.test(status)) {
    return "border-ocean/20 bg-ocean/10 text-ocean";
  }

  return "border-ink/10 bg-white/70 text-ink/75";
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${getStatusClassName(status)}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function SourceBadge({ variant }: { variant: "live" | "seeded" | "simulated" | "governed_preview" }) {
  const configs: Record<typeof variant, { label: string; className: string }> = {
    live:             { label: "LIVE",             className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    seeded:           { label: "SEEDED",           className: "border-amber-200 bg-amber-50 text-amber-700" },
    simulated:        { label: "SIMULATED",        className: "border-ocean/20 bg-ocean/10 text-ocean" },
    governed_preview: { label: "GOVERNED PREVIEW", className: "border-ocean/20 bg-ocean/5 text-ocean" },
  };
  const config = configs[variant];
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${config.className}`}>
      {config.label}
    </span>
  );
}

function SectionCard({
  title,
  children,
  eyebrow,
}: {
  title: string;
  children: ReactNode;
  eyebrow: string;
}) {
  return (
    <section className="glass-card rounded-[2rem] p-6 shadow-float">
      <p className="section-label">{eyebrow}</p>
      <h2 className="headline mt-3 text-2xl font-semibold text-ink">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  tone = "default",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "accent" | "warning";
}) {
  const toneClassName = tone === "accent"
    ? "border-ocean/20 bg-ocean text-white"
    : tone === "warning"
      ? "border-coral/20 bg-coral text-white"
      : "border-ink/10 bg-white text-ink";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 ${toneClassName}`}
    >
      {label}
    </button>
  );
}

function StudioMetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate">{label}</p>
      <p className="mt-2 headline text-3xl font-semibold text-ink">{value}</p>
      <p className="mt-2 text-sm leading-7 body-muted">{detail}</p>
    </article>
  );
}

function GoalRow({
  goal,
  children,
}: {
  goal: OperatorDashboardGoal;
  children?: ReactNode;
}) {
  return (
    <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="headline text-lg font-semibold text-ink">{goal.description}</h3>
            <StatusBadge status={goal.status} />
          </div>
          <p className="text-sm leading-7 body-muted">{goal.explanation}</p>
          <p className="text-xs uppercase tracking-[0.18em] text-slate">Priority {goal.priority}</p>
        </div>
        {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
      </div>
    </article>
  );
}

function ChatMessageRow({
  role,
  kind,
  content,
  createdAt,
}: {
  role: "operator" | "ai-e" | "system";
  kind: string;
  content: string;
  createdAt: string;
}) {
  const accentClassName = role === "operator"
    ? "border-ocean/20 bg-ocean/10"
    : role === "ai-e"
      ? "border-emerald-200 bg-emerald-50"
      : "border-ink/10 bg-white";

  return (
    <article className={`rounded-[1.25rem] border p-4 ${accentClassName}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={role} />
        <p className="text-xs uppercase tracking-[0.18em] text-slate">{kind}</p>
        <p className="text-xs text-slate">{createdAt}</p>
      </div>
      <p className="mt-3 text-sm leading-7 body-muted">{content}</p>
    </article>
  );
}

function StrategyGoalRow({
  goal,
  score,
  onApprove,
  onReject,
  onDefer,
  onActivate,
  onPause,
  onArchive,
  onDecompose,
  disabled,
}: {
  goal: StrategyGoal;
  score: StrategyPortfolioScore | null;
  onApprove: () => void;
  onReject: () => void;
  onDefer: () => void;
  onActivate: () => void;
  onPause: () => void;
  onArchive: () => void;
  onDecompose: () => void;
  disabled: boolean;
}) {
  return (
    <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="headline text-lg font-semibold text-ink">{goal.title}</h3>
            <StatusBadge status={goal.status} />
            <StatusBadge status={goal.priority} />
            <StatusBadge status={goal.category} />
          </div>
          <p className="text-sm leading-7 body-muted">{goal.summary}</p>
          <p className="text-xs text-slate">
            Rank {score?.portfolio_rank ?? "-"} | Portfolio score {score?.score_breakdown.total ?? 0} | Impact {goal.impact_score} | Effort {goal.effort_score} | Risk {goal.risk_score} | Confidence {goal.confidence_score}
          </p>
          <p className="text-xs text-slate">Owner: {goal.owner_agent_role} | Horizon: {goal.time_horizon.replace(/_/g, " ")}</p>
          <p className="text-xs text-slate">Linked work: {goal.linked_work_item_ids.length ? goal.linked_work_item_ids.join(", ") : "none"}</p>
          <p className="text-xs text-slate">Recommended next action: {score?.recommended_action.replace(/_/g, " ") ?? "none"}</p>
          {goal.blocked_by.length ? <p className="text-xs text-ember">Blocked by: {goal.blocked_by.join(" | ")}</p> : null}
          {score?.risk_notes.length ? <p className="text-xs text-slate">Risk notes: {score.risk_notes.join(" | ")}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton label="Approve Strategy Goal" onClick={onApprove} disabled={disabled || !["proposed", "under_review"].includes(goal.status)} tone="accent" />
          <ActionButton label="Reject Strategy Goal" onClick={onReject} disabled={disabled || ["rejected", "archived"].includes(goal.status)} tone="warning" />
          <ActionButton label="Defer Strategy Goal" onClick={onDefer} disabled={disabled || ["completed", "archived"].includes(goal.status)} />
          <ActionButton label="Activate Strategy Goal" onClick={onActivate} disabled={disabled || !["approved", "paused"].includes(goal.status) || goal.blocked_by.length > 0} tone="accent" />
          <ActionButton label="Pause Strategy Goal" onClick={onPause} disabled={disabled || !["active", "approved"].includes(goal.status)} tone="warning" />
          <ActionButton label="Archive Strategy Goal" onClick={onArchive} disabled={disabled || goal.status === "active" || goal.status === "archived"} />
          <ActionButton label="Decompose Strategy Goal" onClick={onDecompose} disabled={disabled || !["approved", "active"].includes(goal.status)} />
        </div>
      </div>
    </article>
  );
}

// Governed Runtime Lane Row (formerly AutonomousSessionRow)
function GovernedRuntimeLaneRow({
  lane,
  mergeTargetLaneId,
  onPause,
  onResume,
  onTerminate,
  onPromote,
  onMerge,
  disabled,
}: {
  lane: OperatorDashboardGovernedRuntimeLane;
  mergeTargetLaneId: string | null;
  onPause: () => void;
  onResume: () => void;
  onTerminate: () => void;
  onPromote: (priority: "critical" | "high" | "medium" | "low") => void;
  onMerge: () => void;
  disabled: boolean;
}) {
  return (
    <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="headline text-lg font-semibold text-ink">{lane.session_id}</h3>
            <StatusBadge status={lane.status} />
            <StatusBadge status={lane.priority} />
            <StatusBadge status={lane.session_type} />
          </div>
          <p className="text-sm leading-7 body-muted">
            CPU {lane.logical_cpu_units} | Chains {lane.active_chain_count} | Queued work {lane.queued_work_item_count} | Tick budget left {lane.tick_budget_remaining}
          </p>
          <p className="text-xs text-slate">
            Agents: {lane.assigned_agent_ids.length > 0 ? lane.assigned_agent_ids.join(", ") : "none"}
          </p>
          <p className="text-xs text-slate">
            Coordination: {lane.coordination_group_id ?? "none"} | Parent: {lane.parent_session_id ?? "none"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {lane.status === "running" ? (
            <ActionButton label="Pause" onClick={onPause} disabled={disabled} tone="warning" />
          ) : null}
          {lane.status === "paused" || lane.status === "blocked" ? (
            <ActionButton label="Resume" onClick={onResume} disabled={disabled} tone="accent" />
          ) : null}
          <ActionButton label="Critical" onClick={() => onPromote("critical")} disabled={disabled} />
          <ActionButton label="High" onClick={() => onPromote("high")} disabled={disabled} />
          <ActionButton label="Medium" onClick={() => onPromote("medium")} disabled={disabled} />
          <ActionButton label="Low" onClick={() => onPromote("low")} disabled={disabled} />
          <ActionButton label="Merge" onClick={onMerge} disabled={disabled || !mergeTargetLaneId} />
          <ActionButton label="Terminate" onClick={onTerminate} disabled={disabled} tone="warning" />
        </div>
      </div>
    </article>
  );
}

function BlockedGoalRow({
  goal,
  onRetry,
  disabled,
}: {
  goal: OperatorDashboardBlockedGoal;
  onRetry: () => void;
  disabled: boolean;
}) {
  return (
    <article className="rounded-[1.5rem] border border-coral/15 bg-coral/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="headline text-lg font-semibold text-ink">{goal.description}</h3>
            <StatusBadge status={goal.blocker_type} />
          </div>
          <p className="text-sm leading-7 body-muted">{goal.explanation}</p>
          <p className="text-xs text-slate">Blockers: {goal.blocker_ids.length > 0 ? goal.blocker_ids.join(", ") : "runtime gate"}</p>
        </div>
        <ActionButton label="Retry" onClick={onRetry} disabled={disabled} tone="warning" />
      </div>
    </article>
  );
}

function ApprovalRow({
  approval,
  onApprove,
  disabled,
}: {
  approval: OperatorDashboardApprovalRequirement;
  onApprove: () => void;
  disabled: boolean;
}) {
  return (
    <article className="rounded-[1.5rem] border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="headline text-lg font-semibold text-ink">{approval.goal_id ?? "Global approval refresh"}</h3>
            <StatusBadge status="approval_required" />
          </div>
          <p className="text-sm leading-7 body-muted">{approval.reason}</p>
          <p className="text-xs text-slate">Needs: {approval.approvals_needed.join(", ")}</p>
        </div>
        <ActionButton label="Approve" onClick={onApprove} disabled={disabled} tone="accent" />
      </div>
    </article>
  );
}

function RecoveryRow({
  recommendation,
  blockedGoal,
  onRetry,
  disabled,
}: {
  recommendation: OperatorDashboardRecoveryRecommendation;
  blockedGoal: OperatorDashboardBlockedGoal | null;
  onRetry: () => void;
  disabled: boolean;
}) {
  return (
    <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="headline text-lg font-semibold text-ink">{recommendation.recommendation.replace(/_/g, " ")}</h3>
            <StatusBadge status={recommendation.severity} />
          </div>
          <p className="text-sm leading-7 body-muted">{recommendation.reason}</p>
          <p className="text-xs text-slate">Source: {recommendation.source} | Category: {recommendation.category}</p>
        </div>
        <ActionButton
          label={blockedGoal ? `Retry ${blockedGoal.goal_id}` : "Retry next goal"}
          onClick={onRetry}
          disabled={disabled}
          tone="warning"
        />
      </div>
    </article>
  );
}

function WorkItemRow({
  item,
  onApprove,
  onReject,
  onDefer,
  disabled,
}: {
  item: AutonomousWorkItem;
  onApprove: () => void;
  onReject: () => void;
  onDefer: () => void;
  disabled: boolean;
}) {
  return (
    <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="headline text-lg font-semibold text-ink">{item.title}</h3>
            <StatusBadge status={item.status} />
            <StatusBadge status={item.risk_level} />
          </div>
          <p className="text-sm leading-7 body-muted">{item.summary}</p>
          <p className="text-xs text-slate">Priority: {item.priority} | Tick cost: {item.estimated_tick_cost} | Approval: {item.required_approval_level}</p>
          <p className="text-xs text-slate">Agent roles: {item.required_agent_roles.length ? item.required_agent_roles.join(", ") : "none"}</p>
          <p className="text-xs text-slate">Expected outputs: {item.expected_outputs.length ? item.expected_outputs.join(", ") : "none"}</p>
        </div>
        {item.status !== "completed" && item.status !== "rejected" ? (
          <div className="flex flex-wrap gap-2">
            <ActionButton label="Approve + Queue" onClick={onApprove} disabled={disabled} tone="accent" />
            <ActionButton label="Reject" onClick={onReject} disabled={disabled} tone="warning" />
            <ActionButton label="Defer" onClick={onDefer} disabled={disabled} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ReviewPackageRow({
  item,
  onApprove,
  onReject,
  disabled,
}: {
  item: AutonomousReviewPackage;
  onApprove: () => void;
  onReject: () => void;
  disabled: boolean;
}) {
  const unityEvidence = extractUnityValidationEvidenceFromReviewPackage(item);

  return (
    <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="headline text-lg font-semibold text-ink">{item.work_item_id}</h3>
            <StatusBadge status={item.status} />
            <StatusBadge status={item.recommended_decision} />
          </div>
          <p className="text-sm leading-7 body-muted">{item.summary}</p>
          <p className="text-xs text-slate">Chain: {item.chain_id} | Files: {item.files_changed.length} | Tests: {item.tests_run.length} | Proofs: {item.proof_results.length}</p>
          <p className="text-xs text-slate">Risks: {item.risks.length ? item.risks.join(", ") : "none recorded"}</p>
          <p className="text-xs text-slate">Rollback: {item.rollback_notes}</p>
          {unityEvidence ? <UnityValidationEvidencePanel evidence={unityEvidence} /> : null}
        </div>
        {item.status === "pending" ? (
          <div className="flex flex-wrap gap-2">
            <ActionButton label="Approve Package" onClick={onApprove} disabled={disabled} tone="accent" />
            <ActionButton label="Reject Package" onClick={onReject} disabled={disabled} tone="warning" />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function DeliveryPackageRow({
  item,
  onApproveForCommit,
  onRejectDelivery,
  onRequestChanges,
  onArchive,
  disabled,
}: {
  item: AutonomousDeliveryPackage;
  onApproveForCommit: () => void;
  onRejectDelivery: () => void;
  onRequestChanges: () => void;
  onArchive: () => void;
  disabled: boolean;
}) {
  const unityEvidence = extractUnityValidationEvidenceFromDeliveryPackage(item);

  return (
    <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="headline text-lg font-semibold text-ink">{item.work_item_id}</h3>
            <StatusBadge status={item.status} />
            {item.operator_decision ? <StatusBadge status={item.operator_decision} /> : null}
          </div>
          <p className="text-sm leading-7 body-muted">{item.release_notes}</p>
          <p className="text-xs text-slate">Branch: {item.branch_name} | Files: {item.files_changed.length} | Validation: {item.validation_results.length} | Proofs: {item.proof_results.length}</p>
          <p className="text-xs text-slate">Commit plan: {item.commit_plan.length ? item.commit_plan.join(" | ") : "none recorded"}</p>
          <p className="text-xs text-slate">Rollback: {item.rollback_plan}</p>
          <p className="text-xs text-slate">PR title: {item.recommended_pr_title}</p>
          {unityEvidence ? <UnityValidationEvidencePanel evidence={unityEvidence} /> : null}
        </div>
        {item.status !== "archived" && item.status !== "rejected" ? (
          <div className="flex flex-wrap gap-2">
            <ActionButton label="Approve For Commit" onClick={onApproveForCommit} disabled={disabled} tone="accent" />
            <ActionButton label="Reject Delivery" onClick={onRejectDelivery} disabled={disabled} tone="warning" />
            <ActionButton label="Request Changes" onClick={onRequestChanges} disabled={disabled} />
            <ActionButton label="Archive Package" onClick={onArchive} disabled={disabled} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function AgentRuntimeRow({ agent }: { agent: AgentRuntimeNode }) {
  return (
    <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="headline text-lg font-semibold text-ink">{agent.agent_id}</h3>
        <StatusBadge status={agent.role} />
        <StatusBadge status={agent.status} />
      </div>
      <p className="mt-3 text-sm leading-7 body-muted">{agent.last_event_summary ?? "No agent event has been recorded yet."}</p>
      <p className="mt-2 text-xs leading-6 text-slate">Assigned goals: {agent.assigned_goal_ids.length ? agent.assigned_goal_ids.join(", ") : "none"}</p>
      <p className="mt-1 text-xs leading-6 text-slate">Current goal: {agent.current_goal_id ?? "none"}</p>
      <p className="mt-1 text-xs leading-6 text-slate">Approval state: {agent.approval_state}</p>
      <p className="mt-1 text-xs leading-6 text-slate">Safety scope: {agent.safety_scope}</p>
    </article>
  );
}

function ExecutionChainRow({ chain }: { chain: ExecutionChainRecord }) {
  return (
    <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="headline text-lg font-semibold text-ink">{chain.chain_id}</h3>
        <StatusBadge status={chain.status} />
        <StatusBadge status={chain.safety_status} />
      </div>
      <p className="mt-3 text-sm leading-7 body-muted">{chain.last_transition}</p>
      <p className="mt-2 text-xs leading-6 text-slate">Parent goal: {chain.parent_goal_id ?? "runtime"}</p>
      <p className="mt-1 text-xs leading-6 text-slate">Step: {chain.current_step}/{chain.total_steps}</p>
      <p className="mt-1 text-xs leading-6 text-slate">Agents: {chain.agent_ids.join(", ")}</p>
      <p className="mt-1 text-xs leading-6 text-slate">Completed at: {chain.completed_at ?? "in progress"}</p>
      {chain.failure_reason ? <p className="mt-1 text-xs leading-6 text-ember">Failure: {chain.failure_reason}</p> : null}
    </article>
  );
}

function describeRuntimeEvent(event: OperatorRuntimeObservabilityEvent): string {
  if (event.goal_transition?.summary) {
    return event.goal_transition.summary;
  }

  if (event.mutation_applied) {
    return event.mutation_applied;
  }

  return event.reason;
}

function formatSafetyGateDecision(value: OperatorRuntimeObservabilityEvent["safety_gate_result"] | string | null | undefined): string {
  if (!value) {
    return "No safety gate decision has been recorded yet.";
  }

  return value.replace(/_/g, " ");
}

function getSourceLabel(source: OperatorRuntimeStateProviderResult["source"]): string {
  switch (source) {
    case "live_runtime":
      return "Live Runtime";
    case "unavailable":
      return "Unavailable";
    case "demo_seed":
    default:
      return "Demo Seed";
  }
}

function getSourceExplanation(result: OperatorRuntimeStateProviderResult): string {
  switch (result.source) {
    case "live_runtime":
      return "This dashboard is connected to live AI-E runtime state.";
    case "unavailable":
      return "No runtime state is available.";
    case "demo_seed":
    default:
      return "This dashboard is using seeded demo state. It demonstrates AI-E reasoning and controls but is not connected to live runtime state yet.";
  }
}

async function executeAction(
  providerResult: OperatorRuntimeStateProviderResult,
  action: OperatorControlAction,
): Promise<{
  providerResult: OperatorRuntimeStateProviderResult;
  message: string;
  isRejected: boolean;
}> {
  if (!providerResult.dashboard_state) {
    return {
      providerResult,
      message: "No dashboard state is available for this operator action.",
      isRejected: true,
    };
  }

  if (providerResult.source === "live_runtime") {
    const response = await fetch("/api/operator/runtime-action", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ action }),
    });
    const payload = await response.json() as {
      error?: string;
      providerResult?: OperatorRuntimeStateProviderResult;
      actionResult?: {
        result: "accepted" | "rejected";
        reason: string;
      };
    };

    if (!response.ok || !payload.actionResult) {
      const message = payload.error ?? "The live runtime action could not be applied.";
      return {
        providerResult,
        message,
        isRejected: true,
      };
    }

    return {
      providerResult: payload.providerResult ?? providerResult,
      message: payload.actionResult.reason,
      isRejected: payload.actionResult.result !== "accepted",
    };
  }

  const result = applyOperatorControlAction(providerResult.dashboard_state, action);
  return {
    providerResult: {
      ...providerResult,
      dashboard_state: result.state,
    },
    message: result.message,
    isRejected: !result.changed,
  };
}

export function OperatorDashboardClient({ initialProviderResult }: { initialProviderResult: OperatorRuntimeStateProviderResult }) {
  const router = useRouter();
  const [providerResult, setProviderResult] = useState<OperatorRuntimeStateProviderResult>(initialProviderResult);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(`${getSourceLabel(initialProviderResult.source)} state loaded.`);
  const [isHydrated, setIsHydrated] = useState(false);
  const [maxDurationHours, setMaxDurationHours] = useState("8");
  const [tickBudget, setTickBudget] = useState("12");
  const [maxChainCount, setMaxChainCount] = useState("8");
  const [approvalPolicy, setApprovalPolicy] = useState<SupervisedSessionControlInput["approval_policy"]>("operator_must_approve_start");
  const [overnightModeEnabled, setOvernightModeEnabled] = useState(false);
  const [allowedTimeWindowStart, setAllowedTimeWindowStart] = useState("22:00");
  const [allowedTimeWindowEnd, setAllowedTimeWindowEnd] = useState("06:00");
  const [maxRetriesPerChain, setMaxRetriesPerChain] = useState("1");
  const [maxRecoveryAttempts, setMaxRecoveryAttempts] = useState("2");
  const [checkpointIntervalTicks, setCheckpointIntervalTicks] = useState("1");
  const [reviewQueueEnabled, setReviewQueueEnabled] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [intakeText, setIntakeText] = useState("");
  const [governedProposal, setGovernedProposal] = useState<GovernedOperationProposal | null>(null);
  const [proofDispatchState, setProofDispatchState] = useState<ProofDispatchLifecycleState>("idle");
  const [proofDispatchResult, setProofDispatchResult] = useState<ProofDispatchClientResult | null>(null);
  const [proofDispatchApiError, setProofDispatchApiError] = useState<ProofDispatchApiError | null>(null);
  const [proofOperatorId, setProofOperatorId] = useState("operator");

  const [runtimeAdapterDispatchState, setRuntimeAdapterDispatchState] = useState<RuntimeAdapterDispatchLifecycleState>("idle");
  const [runtimeAdapterDispatchResult, setRuntimeAdapterDispatchResult] = useState<RuntimeAdapterDispatchClientResult | null>(null);
  const [runtimeAdapterDispatchApiError, setRuntimeAdapterDispatchApiError] = useState<RuntimeAdapterDispatchApiError | null>(null);
  const [runtimeAdapterOperatorId, setRuntimeAdapterOperatorId] = useState("operator");

  async function handleRuntimeAdapterDispatch() {
    setRuntimeAdapterDispatchState("dispatching");
    setRuntimeAdapterDispatchResult(null);
    setRuntimeAdapterDispatchApiError(null);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    try {
      const res = await fetch("/api/operator/runtime-adapter-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalToken: "operator-approved",
          operationRequest: "Write AI_E_RUNTIME_PROOF.txt to sandbox workspace",
          authorization: {
            authorityToken: "operator-approved",
            approvedBy: runtimeAdapterOperatorId.trim() || "operator",
            approvedAt: nowIso,
            proposalId: `proposal-exec0052b-${Date.now()}`,
            operationRequest: "Write AI_E_RUNTIME_PROOF.txt to sandbox workspace",
          },
          expiresAt,
          operatorId: runtimeAdapterOperatorId.trim() || "operator",
        }),
      });
      const data = (await res.json()) as RuntimeAdapterDispatchClientResult | RuntimeAdapterDispatchApiError;
      if (!res.ok) {
        setRuntimeAdapterDispatchApiError(data as RuntimeAdapterDispatchApiError);
        setRuntimeAdapterDispatchState("failed");
        return;
      }
      const result = data as RuntimeAdapterDispatchClientResult;
      setRuntimeAdapterDispatchResult(result);
      setRuntimeAdapterDispatchState(result.outcome === "completed" ? "completed" : "failed");
    } catch {
      setRuntimeAdapterDispatchState("failed");
    }
  }

  const [sandboxPatchDispatchState, setSandboxPatchDispatchState] = useState<SandboxPatchDispatchLifecycleState>("idle");
  const [sandboxPatchDispatchResult, setSandboxPatchDispatchResult] = useState<SandboxPatchDispatchClientResult | null>(null);
  const [sandboxPatchDispatchApiError, setSandboxPatchDispatchApiError] = useState<SandboxPatchDispatchApiError | null>(null);
  const [sandboxPatchOperatorId, setSandboxPatchOperatorId] = useState("operator");

  async function handleSandboxPatchDispatch() {
    setSandboxPatchDispatchState("dispatching");
    setSandboxPatchDispatchResult(null);
    setSandboxPatchDispatchApiError(null);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    try {
      const res = await fetch("/api/operator/sandbox-patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalToken: "operator-approved",
          operationRequest: "Apply sandbox patch mutation to sandboxPatch.ts",
          authorization: {
            authorityToken: "operator-approved",
            approvedBy: sandboxPatchOperatorId.trim() || "operator",
            approvedAt: nowIso,
            proposalId: `proposal-exec0052c-${Date.now()}`,
            operationRequest: "Apply sandbox patch mutation to sandboxPatch.ts",
          },
          expiresAt,
          operatorId: sandboxPatchOperatorId.trim() || "operator",
        }),
      });
      const data = (await res.json()) as SandboxPatchDispatchClientResult | SandboxPatchDispatchApiError;
      if (!res.ok) {
        setSandboxPatchDispatchApiError(data as SandboxPatchDispatchApiError);
        setSandboxPatchDispatchState("failed");
        return;
      }
      const result = data as SandboxPatchDispatchClientResult;
      setSandboxPatchDispatchResult(result);
      setSandboxPatchDispatchState(result.outcome === "completed" ? "completed" : "failed");
    } catch {
      setSandboxPatchDispatchState("failed");
    }
  }

  async function handleProofDispatch() {
    setProofDispatchState("dispatching");
    setProofDispatchResult(null);
    setProofDispatchApiError(null);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    try {
      const res = await fetch("/api/operator/sandbox-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalToken: "operator-approved",
          operationRequest: "Write AI_E_DISPATCH_PROOF.txt to sandbox workspace",
          authorization: {
            authorityToken: "operator-approved",
            approvedBy: proofOperatorId.trim() || "operator",
            approvedAt: nowIso,
            proposalId: `proposal-exec0051c-${Date.now()}`,
            operationRequest: "Write AI_E_DISPATCH_PROOF.txt to sandbox workspace",
          },
          expiresAt,
          operatorId: proofOperatorId.trim() || "operator",
          runtimeId: "aie-exec0051c-bounded-write",
        }),
      });
      const data = (await res.json()) as ProofDispatchClientResult | ProofDispatchApiError;
      if (!res.ok) {
        setProofDispatchApiError(data as ProofDispatchApiError);
        setProofDispatchState("failed");
        return;
      }
      const result = data as ProofDispatchClientResult;
      setProofDispatchResult(result);
      setProofDispatchState(result.outcome === "completed" ? "completed" : "failed");
    } catch {
      setProofDispatchState("failed");
    }
  }

  useEffect(() => {
    setProviderResult(initialProviderResult);
    setError(null);
    setMessage(`${getSourceLabel(initialProviderResult.source)} state loaded.`);

    const session = initialProviderResult.dashboard_state?.supervised_session;
    if (session) {
      setMaxDurationHours(String(Math.max(1, Math.round(session.max_duration_ms / 3_600_000))));
      setTickBudget(String(session.tick_budget));
      setMaxChainCount(String(session.max_chain_count));
      setApprovalPolicy(session.approval_policy);
      setOvernightModeEnabled(Boolean(session.overnight_policy));
      setAllowedTimeWindowStart(session.overnight_policy?.allowed_time_window.start_time ?? "22:00");
      setAllowedTimeWindowEnd(session.overnight_policy?.allowed_time_window.end_time ?? "06:00");
      setMaxRetriesPerChain(String(session.overnight_policy?.max_retries_per_chain ?? 1));
      setMaxRecoveryAttempts(String(session.overnight_policy?.max_recovery_attempts ?? 2));
      setCheckpointIntervalTicks(String(session.overnight_policy?.checkpoint_interval_ticks ?? 1));
      setReviewQueueEnabled(session.overnight_policy?.review_queue_enabled ?? true);
    }
  }, [initialProviderResult]);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (providerResult.source !== "live_runtime") {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [providerResult.source, router]);

  const dashboardState: OperatorDashboardState | null = providerResult.dashboard_state;
  const studioOperations = dashboardState?.studio_operations ?? null;
  const metaIntelligence = dashboardState?.meta_intelligence ?? null;
  const metaPolicyState = dashboardState?.meta_policy_state ?? null;
  const strategyGoals = dashboardState?.strategy_goals ?? [];
  const strategyScores = dashboardState?.strategy_portfolio_scores ?? [];
  const strategyScoreMap = new Map(strategyScores.map((item) => [item.strategy_goal_id, item]));
  const proposedStrategyGoals = strategyGoals.filter((goal) => ["proposed", "under_review"].includes(goal.status));
  const approvedStrategyGoals = strategyGoals.filter((goal) => goal.status === "approved");
  const activeStrategyGoals = strategyGoals.filter((goal) => goal.status === "active" || goal.status === "paused");
  const blockedStrategyGoals = strategyGoals.filter((goal) => goal.status === "blocked" || goal.blocked_by.length > 0);
  const completedStrategyGoals = strategyGoals.filter((goal) => ["completed", "rejected", "archived"].includes(goal.status));
  const latestCheckpoint = dashboardState?.supervised_checkpoints?.slice(-1)[0] ?? null;
  const activeSession = dashboardState?.supervised_session ?? null;
  const chatSession = dashboardState?.conversational_session ?? null;

  function buildSupervisedSessionInput(): SupervisedSessionControlInput {
    const parsedHours = Number(maxDurationHours);
    const parsedTickBudget = Number(tickBudget);
    const parsedMaxChainCount = Number(maxChainCount);
    const parsedMaxRetriesPerChain = Number(maxRetriesPerChain);
    const parsedMaxRecoveryAttempts = Number(maxRecoveryAttempts);
    const parsedCheckpointIntervalTicks = Number(checkpointIntervalTicks);

    return {
      max_duration_ms: Number.isFinite(parsedHours) && parsedHours > 0 ? Math.trunc(parsedHours * 3_600_000) : 28_800_000,
      tick_budget: Number.isFinite(parsedTickBudget) && parsedTickBudget > 0 ? Math.trunc(parsedTickBudget) : 12,
      max_chain_count: Number.isFinite(parsedMaxChainCount) && parsedMaxChainCount > 0 ? Math.trunc(parsedMaxChainCount) : 8,
      approval_policy: approvalPolicy ?? "operator_must_approve_start",
      recovery_policy: activeSession?.recovery_policy ?? "request_operator_review",
      overnight_mode_enabled: overnightModeEnabled,
      max_runtime_hours: Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 8,
      allowed_time_window_start: allowedTimeWindowStart,
      allowed_time_window_end: allowedTimeWindowEnd,
      max_tick_count: Number.isFinite(parsedTickBudget) && parsedTickBudget > 0 ? Math.trunc(parsedTickBudget) : 12,
      max_retries_per_chain: Number.isFinite(parsedMaxRetriesPerChain) && parsedMaxRetriesPerChain >= 0 ? Math.trunc(parsedMaxRetriesPerChain) : 1,
      max_recovery_attempts: Number.isFinite(parsedMaxRecoveryAttempts) && parsedMaxRecoveryAttempts >= 0 ? Math.trunc(parsedMaxRecoveryAttempts) : 2,
      checkpoint_interval_ticks: Number.isFinite(parsedCheckpointIntervalTicks) && parsedCheckpointIntervalTicks > 0 ? Math.trunc(parsedCheckpointIntervalTicks) : 1,
      review_queue_enabled: reviewQueueEnabled,
    };
  }

  function handleAction(action: OperatorControlAction) {
    setError(null);
    startTransition(() => {
      void executeAction(providerResult, action)
        .then((result) => {
          setProviderResult(result.providerResult);
          setMessage(result.message);
          if (providerResult.source === "live_runtime" && !result.isRejected) {
            router.refresh();
          }
          if (result.isRejected) {
            setError(result.message);
          }
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "The control action failed.");
        });
    });
  }

  const firstBlockedGoal = dashboardState?.blocked_goals[0] ?? null;

  return (
    <main className="page-shell min-h-screen px-6 py-10 lg:px-10 lg:py-14">
      <div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-6">
        <section className="glass-card rounded-[2rem] p-8 shadow-float">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl space-y-4">
              <p className="section-label">AI-E Operator Console</p>
              <h1 className="headline text-4xl font-semibold text-ink lg:text-5xl">Governed runtime lanes, operator authority, and bounded execution.</h1>
              <p className="max-w-2xl text-base leading-8 body-muted">
                This console surfaces governed runtime lanes, operator approvals, review queues, and receipts. All operations are bounded, reviewable, and operator-authoritative. Demo/seeded state is clearly labeled below.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/" className="rounded-full border border-ink/10 bg-white/70 px-5 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5">
                Home
              </Link>
              <ActionButton
                label="Refresh state"
                onClick={() => {
                  setMessage("Refreshing operator state...");
                  router.refresh();
                }}
                disabled={isPending}
              />
            </div>
          </div>
          <div className={`mt-6 rounded-[1.5rem] border p-4 ${providerResult.source === "live_runtime" ? "border-emerald-200 bg-emerald-50/70" : providerResult.source === "demo_seed" ? "border-amber-200 bg-amber-50/70" : "border-coral/20 bg-coral/10"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate">State Source:</p>
              {providerResult.source === "live_runtime" ? <SourceBadge variant="live" /> : null}
              {providerResult.source === "demo_seed" ? <SourceBadge variant="seeded" /> : null}
              {providerResult.source === "unavailable" ? <SourceBadge variant="simulated" /> : null}
              <p className="text-xs uppercase tracking-[0.18em] text-slate">{getSourceLabel(providerResult.source)}</p>
            </div>
            <p className="mt-2 text-sm leading-7 body-muted">{getSourceExplanation(providerResult)}</p>
            {providerResult.source === "demo_seed" ? (
              <p className="mt-2 text-xs font-bold text-ember">SEEDED STATE: This is a demonstration of the AI-E Operator Console. No live runtime execution is occurring. Governed runtime lanes and all other sections below reflect seeded demo data — not live runtime state.</p>
            ) : null}
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate">Client Controls: {isHydrated ? "Ready" : "Loading"}</p>
            {providerResult.warnings.length > 0 ? (
              <p className="mt-2 text-sm leading-7 body-muted">{providerResult.warnings.join(" ")}</p>
            ) : null}
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate">Runtime</p>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={dashboardState?.runtime_status.status ?? "unavailable"} />
              </div>
              <p className="mt-3 text-sm leading-7 body-muted">{dashboardState?.runtime_status.explanation ?? "No runtime state is available."}</p>
            </div>
            <div className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate">Queue</p>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={dashboardState?.queue_status.status ?? "unavailable"} />
              </div>
              <p className="mt-3 text-sm leading-7 body-muted">{dashboardState?.queue_status.explanation ?? "No queue state is available."}</p>
            </div>
            <div className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate">Updated</p>
              <p className="mt-3 text-sm leading-7 body-muted">{dashboardState?.last_updated_at ?? providerResult.loaded_at}</p>
              {message ? <p className="mt-2 text-sm font-medium text-ocean">{message}</p> : null}
              {error ? <p className="mt-2 text-sm font-medium text-ember">{error}</p> : null}
            </div>
          </div>
        </section>

        {/* Task Intake */}
        <SectionCard eyebrow="Task Intake" title="Create Governed Operation">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-ocean/20 bg-ocean/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-ocean">GOVERNED PREVIEW</span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-700">SIMULATED</span>
            <p className="text-xs text-slate">Describe an operation. A governed proposal will be generated client-side. No execution occurs.</p>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {[
              "Fix enemy patrol AI behavior",
              "Refactor the API layer types",
              "Review test coverage for dashboard",
              "Fix fall recovery after ledge drop",
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => { setIntakeText(chip); setGovernedProposal(null); }}
                className="rounded-full border border-ink/10 bg-white/70 px-4 py-2 text-xs font-medium text-ink transition hover:-translate-y-0.5"
              >
                {chip}
              </button>
            ))}
          </div>
          <textarea
            value={intakeText}
            onChange={(e) => { setIntakeText(e.target.value); setGovernedProposal(null); }}
            placeholder="Describe the operation to govern (e.g. fix enemy patrol AI, refactor authentication types)…"
            className="w-full resize-none rounded-[1.25rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm text-ink placeholder:text-slate focus:outline-none focus:ring-2 focus:ring-ocean/20"
            rows={3}
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={intakeText.trim().length === 0}
              onClick={() => { setGovernedProposal(generateGovernedOperationProposal(intakeText.trim())); }}
              className="rounded-full border border-ocean/20 bg-ocean px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Create Governed Operation
            </button>
            {governedProposal ? (
              <button
                type="button"
                onClick={() => { setGovernedProposal(null); setIntakeText(""); }}
                className="rounded-full border border-ink/10 bg-white/70 px-5 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
              >
                Clear Proposal
              </button>
            ) : null}
          </div>
          {governedProposal ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-[1.5rem] border border-ocean/15 bg-ocean/5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex rounded-full border border-ocean/20 bg-ocean/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-ocean">GOVERNED PREVIEW</span>
                  <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-700">SIMULATED</span>
                  <span className="font-mono text-xs text-slate">{governedProposal.proposalId}</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-ink">{governedProposal.request}</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-[1rem] border border-ink/10 bg-white/80 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Runtime</p>
                    <p className="mt-1 text-xs font-semibold text-ink">{getRuntimeLabel(governedProposal.runtime)}</p>
                  </div>
                  <div className="rounded-[1rem] border border-ink/10 bg-white/80 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Category</p>
                    <p className="mt-1 text-xs font-semibold text-ink">{getCategoryLabel(governedProposal.category)}</p>
                  </div>
                  <div className="rounded-[1rem] border border-ink/10 bg-white/80 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Lane State</p>
                    <p className="mt-1 text-xs font-semibold text-amber-700">Approval Pending</p>
                  </div>
                  <div className="rounded-[1rem] border border-coral/15 bg-coral/5 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Execution</p>
                    <p className="mt-1 text-xs font-bold text-ember">BLOCKED</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {governedProposal.commandPolicy.slice(0, 4).map((item) => (
                    <div
                      key={item.rule}
                      className={`rounded-[1rem] border px-3 py-2 ${item.status === "blocked" ? "border-coral/15 bg-coral/5" : "border-emerald-200 bg-emerald-50/70"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-ink">{item.rule}</p>
                        <span className={`text-xs font-bold uppercase tracking-[0.12em] ${item.status === "blocked" ? "text-ember" : "text-emerald-700"}`}>
                          {item.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Estimated Affected Files</p>
                  <ul className="mt-2 space-y-1">
                    {governedProposal.estimatedAffectedFiles.map((f) => (
                      <li key={f} className="font-mono text-xs text-ink">{f}</li>
                    ))}
                  </ul>
                </div>
                <div className="mt-4 rounded-[1rem] border border-amber-200 bg-amber-50/70 p-3">
                  <p className="text-xs leading-6 text-amber-800">{governedProposal.governanceNote}</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    href="/operator/preview"
                    className="inline-flex rounded-full border border-ocean/20 bg-ocean/5 px-5 py-3 text-sm font-semibold text-ocean transition hover:-translate-y-0.5"
                  >
                    Review in Execution Preview →
                  </Link>
                  <button
                    type="button"
                    className="inline-flex rounded-full border border-emerald-200 bg-emerald-50/70 px-5 py-3 text-sm font-semibold text-emerald-700 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={async () => {
                      // TODO: Wire to /api/operator/sandbox-dispatch
                      // Set dispatch state to 'dispatching', then update with result/receipt
                    }}
                  >
                    Approve &amp; Dispatch
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </SectionCard>

        {/* Proof Dispatch */}
        <SectionCard eyebrow="Proof Dispatch" title="Approve &amp; Dispatch Proof">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">REAL EXECUTION</span>
            <span className="inline-flex rounded-full border border-ocean/20 bg-ocean/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-ocean">EXEC-0051-C</span>
            <p className="text-xs text-slate">First authorized sandbox mutation. Writes AI_E_DISPATCH_PROOF.txt inside the governed sandbox workspace. No production workspace is touched.</p>
          </div>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-[0.18em] text-slate">Operator ID</span>
              <input
                type="text"
                value={proofOperatorId}
                onChange={(e) => setProofOperatorId(e.target.value)}
                placeholder="operator"
                className="rounded-[0.75rem] border border-ink/10 bg-white/80 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ocean/20"
              />
            </label>
            <button
              type="button"
              disabled={proofDispatchState === "dispatching"}
              onClick={() => { void handleProofDispatch(); }}
              className="rounded-full border border-emerald-200 bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {proofDispatchState === "dispatching" ? "Dispatching…" : "Approve & Dispatch Proof"}
            </button>
            {proofDispatchState !== "idle" ? (
              <button
                type="button"
                onClick={() => { setProofDispatchState("idle"); setProofDispatchResult(null); setProofDispatchApiError(null); }}
                className="rounded-full border border-ink/10 bg-white/70 px-4 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
              >
                Reset
              </button>
            ) : null}
          </div>

          {proofDispatchState !== "idle" ? (
            <div className="space-y-3">
              {proofDispatchApiError ? (
                <div className="rounded-[1.25rem] border border-coral/20 bg-coral/10 p-4">
                  <p className="text-sm font-semibold text-ember">{proofDispatchApiError.error}</p>
                  {proofDispatchApiError.hint ? <p className="mt-1 font-mono text-xs text-slate">{proofDispatchApiError.hint}</p> : null}
                </div>
              ) : proofDispatchState === "dispatching" ? (
                <div className="rounded-[1.25rem] border border-ocean/15 bg-ocean/5 p-4">
                  <p className="text-sm body-muted">Verifying authorization → preparing sandbox → executing proof mutation…</p>
                </div>
              ) : proofDispatchResult ? (
                <>
                  {/* Outcome banner */}
                  <div className={`rounded-[1.5rem] border p-4 ${proofDispatchResult.outcome === "completed" ? "border-emerald-200 bg-emerald-50/70" : "border-coral/20 bg-coral/10"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${proofDispatchResult.outcome === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-coral/20 bg-coral/10 text-ember"}`}>
                        {proofDispatchResult.outcome}
                      </span>
                      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">REAL EXECUTION</span>
                      <span className="text-xs text-slate">{proofDispatchResult.durationMs}ms</span>
                    </div>
                    {proofDispatchResult.outcome !== "completed" ? (
                      <p className="mt-2 text-sm text-ember">{proofDispatchResult.error ?? "Dispatch failed"}</p>
                    ) : null}
                  </div>

                  {/* Lifecycle */}
                  <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Lifecycle</p>
                    <ul className="mt-3 space-y-1">
                      {proofDispatchResult.lifecycle.map((step, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${step.state === "completed" ? "bg-emerald-500" : step.state === "failed" ? "bg-ember" : "bg-ocean"}`} />
                          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-slate w-28 flex-shrink-0">{step.state}</span>
                          <span className="text-xs text-ink">{step.message}</span>
                        </li>
                      ))}
                    </ul>
                  </article>

                  {/* Key IDs */}
                  <div className="grid gap-2 sm:grid-cols-3">
                    <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Proof File</p>
                      <p className="mt-1 font-mono text-xs text-ink">{proofDispatchResult.proofFilePath}</p>
                    </article>
                    <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Receipt ID</p>
                      <p className="mt-1 font-mono text-xs text-ink">{proofDispatchResult.receiptId || "—"}</p>
                    </article>
                    <article className={`rounded-[1.25rem] border p-3 ${proofDispatchResult.rollbackContract.rollbackReady ? "border-emerald-200 bg-emerald-50/70" : "border-coral/20 bg-coral/10"}`}>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Rollback</p>
                      <p className={`mt-1 text-xs font-bold ${proofDispatchResult.rollbackContract.rollbackReady ? "text-emerald-700" : "text-ember"}`}>
                        {proofDispatchResult.rollbackContract.rollbackReady ? "READY" : "NOT READY"}
                      </p>
                      {proofDispatchResult.rollbackContract.rollbackReady ? (
                        <p className="mt-0.5 text-xs text-slate">{proofDispatchResult.rollbackContract.rollbackMetadata.diffSummary}</p>
                      ) : null}
                    </article>
                  </div>

                  {/* Snapshot counts */}
                  <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Snapshots</p>
                    <p className="mt-2 text-xs text-slate">Before: <strong>{proofDispatchResult.beforeSnapshotFileCount}</strong> file(s) · After: <strong>{proofDispatchResult.afterSnapshotFileCount}</strong> file(s)</p>
                  </article>

                  {/* Sandbox ID */}
                  <article className="rounded-[1.25rem] border border-amber-200 bg-amber-50/70 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Sandbox ID</p>
                    <p className="mt-1 font-mono text-xs text-amber-900">{proofDispatchResult.sandboxId}</p>
                    <p className="mt-1 text-xs text-amber-700">All artifacts written inside .ai-e/sandboxes/{proofDispatchResult.sandboxId}/. Production workspace not mutated.</p>
                  </article>
                </>
              ) : null}
            </div>
          ) : null}
        </SectionCard>

        {/* Runtime Adapter Dispatch (EXEC-0052-B) */}
        <SectionCard eyebrow="Runtime Adapter Dispatch" title="Approve &amp; Invoke Runtime Adapter">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">REAL EXECUTION</span>
            <span className="inline-flex rounded-full border border-ocean/20 bg-ocean/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-ocean">EXEC-0052-B</span>
            <p className="text-xs text-slate">First real governed runtime adapter invocation. Writes AI_E_RUNTIME_PROOF.txt inside the sandbox workspace via the openclaw bounded local adapter. No production workspace is touched.</p>
          </div>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-[0.18em] text-slate">Operator ID</span>
              <input
                type="text"
                value={runtimeAdapterOperatorId}
                onChange={(e) => setRuntimeAdapterOperatorId(e.target.value)}
                placeholder="operator"
                className="rounded-[0.75rem] border border-ink/10 bg-white/80 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ocean/20"
              />
            </label>
            <button
              type="button"
              disabled={runtimeAdapterDispatchState === "dispatching"}
              onClick={() => { void handleRuntimeAdapterDispatch(); }}
              className="rounded-full border border-emerald-200 bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {runtimeAdapterDispatchState === "dispatching" ? "Dispatching…" : "Approve & Invoke Runtime Adapter"}
            </button>
            {runtimeAdapterDispatchState !== "idle" ? (
              <button
                type="button"
                onClick={() => { setRuntimeAdapterDispatchState("idle"); setRuntimeAdapterDispatchResult(null); setRuntimeAdapterDispatchApiError(null); }}
                className="rounded-full border border-ink/10 bg-white/70 px-4 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
              >
                Reset
              </button>
            ) : null}
          </div>

          {runtimeAdapterDispatchState !== "idle" ? (
            <div className="space-y-3">
              {runtimeAdapterDispatchApiError ? (
                <div className="rounded-[1.25rem] border border-coral/20 bg-coral/10 p-4">
                  <p className="text-sm font-semibold text-ember">{runtimeAdapterDispatchApiError.error}</p>
                  {runtimeAdapterDispatchApiError.hint ? <p className="mt-1 font-mono text-xs text-slate">{runtimeAdapterDispatchApiError.hint}</p> : null}
                </div>
              ) : runtimeAdapterDispatchState === "dispatching" ? (
                <div className="rounded-[1.25rem] border border-ocean/15 bg-ocean/5 p-4">
                  <p className="text-sm body-muted">Verifying authorization → preparing sandbox → invoking openclaw adapter → writing proof…</p>
                </div>
              ) : runtimeAdapterDispatchResult ? (
                <>
                  {/* Outcome banner */}
                  <div className={`rounded-[1.5rem] border p-4 ${runtimeAdapterDispatchResult.outcome === "completed" ? "border-emerald-200 bg-emerald-50/70" : "border-coral/20 bg-coral/10"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${runtimeAdapterDispatchResult.outcome === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-coral/20 bg-coral/10 text-ember"}`}>
                        {runtimeAdapterDispatchResult.outcome}
                      </span>
                      <span className="inline-flex rounded-full border border-ocean/20 bg-ocean/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-ocean">{runtimeAdapterDispatchResult.runtimeType ?? "openclaw"}</span>
                      <span className="text-xs text-slate">{runtimeAdapterDispatchResult.durationMs}ms</span>
                    </div>
                    {runtimeAdapterDispatchResult.outcome !== "completed" ? (
                      <p className="mt-2 text-sm text-ember">{runtimeAdapterDispatchResult.error ?? "Dispatch failed"}</p>
                    ) : null}
                  </div>

                  {/* Lifecycle */}
                  <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Runtime Lifecycle</p>
                    <ul className="mt-3 space-y-1">
                      {runtimeAdapterDispatchResult.lifecycle.records.map((step, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[9px] font-bold text-emerald-700">{i + 1}</span>
                          <span className="font-mono text-xs text-ink">{step.state}</span>
                          {step.message ? <span className="text-xs text-slate">— {step.message}</span> : null}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-slate">Current state: <strong>{runtimeAdapterDispatchResult.lifecycle.currentState}</strong></p>
                  </article>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {/* Proof file */}
                    <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Proof File</p>
                      <p className="mt-1 font-mono text-xs text-ink">{runtimeAdapterDispatchResult.proofFilePath}</p>
                    </article>

                    {/* Receipt */}
                    <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Receipt ID</p>
                      <p className="mt-1 font-mono text-xs text-ink">{runtimeAdapterDispatchResult.receiptId || "—"}</p>
                    </article>

                    {/* Rollback */}
                    <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Rollback</p>
                      <p className={`mt-1 text-xs font-bold ${runtimeAdapterDispatchResult.rollbackContract.rollbackReady ? "text-emerald-700" : "text-ember"}`}>
                        {runtimeAdapterDispatchResult.rollbackContract.rollbackReady ? "READY" : "NOT READY"}
                      </p>
                      {runtimeAdapterDispatchResult.rollbackContract.rollbackReady && runtimeAdapterDispatchResult.rollbackContract.rollbackMetadata ? (
                        <p className="mt-0.5 text-xs text-slate">{runtimeAdapterDispatchResult.rollbackContract.rollbackMetadata.diffSummary}</p>
                      ) : null}
                    </article>

                    {/* Snapshots */}
                    <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Snapshots</p>
                      <p className="mt-2 text-xs text-slate">Before: <strong>{runtimeAdapterDispatchResult.beforeSnapshotFileCount}</strong> file(s) · After: <strong>{runtimeAdapterDispatchResult.afterSnapshotFileCount}</strong> file(s)</p>
                    </article>
                  </div>

                  {/* Sandbox ID */}
                  <article className="rounded-[1.25rem] border border-amber-200 bg-amber-50/70 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Sandbox ID</p>
                    <p className="mt-1 font-mono text-xs text-amber-900">{runtimeAdapterDispatchResult.sandboxId}</p>
                    <p className="mt-1 text-xs text-amber-700">Adapter: {runtimeAdapterDispatchResult.adapterId} · {runtimeAdapterDispatchResult.adapterVersion} · All artifacts written inside .ai-e/sandboxes/{runtimeAdapterDispatchResult.sandboxId}/. Production workspace not mutated.</p>
                  </article>
                </>
              ) : null}
            </div>
          ) : null}
        </SectionCard>

        {/* Sandbox Patch Dispatch (EXEC-0052-C) */}
        <SectionCard eyebrow="Sandbox Patch" title="Approve &amp; Apply Sandbox Patch">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">REAL EXECUTION</span>
            <span className="inline-flex rounded-full border border-ocean/20 bg-ocean/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-ocean">EXEC-0052-C</span>
            <p className="text-xs text-slate">First useful governed sandbox mutation. Reads sandboxPatch.ts and increments patchVersion. On first run: creates the file. Sandbox-scoped only — production workspace not touched.</p>
          </div>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-[0.18em] text-slate">Operator ID</span>
              <input
                type="text"
                value={sandboxPatchOperatorId}
                onChange={(e) => setSandboxPatchOperatorId(e.target.value)}
                placeholder="operator"
                className="rounded-[0.75rem] border border-ink/10 bg-white/80 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ocean/20"
              />
            </label>
            <button
              type="button"
              disabled={sandboxPatchDispatchState === "dispatching"}
              onClick={() => { void handleSandboxPatchDispatch(); }}
              className="rounded-full border border-emerald-200 bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sandboxPatchDispatchState === "dispatching" ? "Patching…" : "Approve & Apply Patch"}
            </button>
            {sandboxPatchDispatchState !== "idle" ? (
              <button
                type="button"
                onClick={() => { setSandboxPatchDispatchState("idle"); setSandboxPatchDispatchResult(null); setSandboxPatchDispatchApiError(null); }}
                className="rounded-full border border-ink/10 bg-white/70 px-4 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
              >
                Reset
              </button>
            ) : null}
          </div>

          {sandboxPatchDispatchState !== "idle" ? (
            <div className="space-y-3">
              {sandboxPatchDispatchApiError ? (
                <div className="rounded-[1.25rem] border border-coral/20 bg-coral/10 p-4">
                  <p className="text-sm font-semibold text-ember">{sandboxPatchDispatchApiError.error}</p>
                  {sandboxPatchDispatchApiError.hint ? <p className="mt-1 font-mono text-xs text-slate">{sandboxPatchDispatchApiError.hint}</p> : null}
                </div>
              ) : sandboxPatchDispatchState === "dispatching" ? (
                <div className="rounded-[1.25rem] border border-ocean/15 bg-ocean/5 p-4">
                  <p className="text-sm body-muted">Verifying authorization → reading sandboxPatch.ts → incrementing patchVersion → writing result…</p>
                </div>
              ) : sandboxPatchDispatchResult ? (
                <>
                  {/* Outcome banner */}
                  <div className={`rounded-[1.5rem] border p-4 ${sandboxPatchDispatchResult.outcome === "completed" ? "border-emerald-200 bg-emerald-50/70" : "border-coral/20 bg-coral/10"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${sandboxPatchDispatchResult.outcome === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-coral/20 bg-coral/10 text-ember"}`}>
                        {sandboxPatchDispatchResult.outcome}
                      </span>
                      <span className="inline-flex rounded-full border border-ocean/20 bg-ocean/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-ocean">{sandboxPatchDispatchResult.runtimeType ?? "openclaw"}</span>
                      <span className="text-xs text-slate">{sandboxPatchDispatchResult.durationMs}ms</span>
                    </div>
                    {sandboxPatchDispatchResult.outcome !== "completed" ? (
                      <p className="mt-2 text-sm text-ember">{sandboxPatchDispatchResult.error ?? "Patch dispatch failed"}</p>
                    ) : null}
                  </div>

                  {/* Lifecycle */}
                  <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Patch Lifecycle</p>
                    <ul className="mt-3 space-y-1">
                      {sandboxPatchDispatchResult.lifecycle.records.map((step, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[9px] font-bold text-emerald-700">{i + 1}</span>
                          <span className="font-mono text-xs text-ink">{step.state}</span>
                          {step.message ? <span className="text-xs text-slate">— {step.message}</span> : null}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-slate">Current state: <strong>{sandboxPatchDispatchResult.lifecycle.currentState}</strong></p>
                  </article>

                  {/* stdout output */}
                  {sandboxPatchDispatchResult.outputCapture.stdout ? (
                    <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Mutation Output</p>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-ink">{sandboxPatchDispatchResult.outputCapture.stdout}</pre>
                    </article>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-2">
                    {/* Patch file */}
                    <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Patch File</p>
                      <p className="mt-1 font-mono text-xs text-ink">{sandboxPatchDispatchResult.patchFilePath}</p>
                    </article>

                    {/* Receipt */}
                    <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Receipt ID</p>
                      <p className="mt-1 font-mono text-xs text-ink">{sandboxPatchDispatchResult.receiptId || "—"}</p>
                    </article>

                    {/* Rollback */}
                    <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Rollback</p>
                      <p className={`mt-1 text-xs font-bold ${sandboxPatchDispatchResult.rollbackContract.rollbackReady ? "text-emerald-700" : "text-ember"}`}>
                        {sandboxPatchDispatchResult.rollbackContract.rollbackReady ? "READY" : "NOT READY"}
                      </p>
                      {sandboxPatchDispatchResult.rollbackContract.rollbackReady && sandboxPatchDispatchResult.rollbackContract.rollbackMetadata ? (
                        <p className="mt-0.5 text-xs text-slate">{sandboxPatchDispatchResult.rollbackContract.rollbackMetadata.diffSummary}</p>
                      ) : null}
                    </article>

                    {/* Snapshots */}
                    <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Snapshots</p>
                      <p className="mt-2 text-xs text-slate">Before: <strong>{sandboxPatchDispatchResult.beforeSnapshotFileCount}</strong> file(s) · After: <strong>{sandboxPatchDispatchResult.afterSnapshotFileCount}</strong> file(s)</p>
                    </article>
                  </div>

                  {/* Sandbox ID */}
                  <article className="rounded-[1.25rem] border border-amber-200 bg-amber-50/70 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Sandbox ID</p>
                    <p className="mt-1 font-mono text-xs text-amber-900">{sandboxPatchDispatchResult.sandboxId}</p>
                    <p className="mt-1 text-xs text-amber-700">Adapter: {sandboxPatchDispatchResult.adapterId} · {sandboxPatchDispatchResult.adapterVersion} · Mutation bounded to .ai-e/sandboxes/{sandboxPatchDispatchResult.sandboxId}/. Production workspace not mutated.</p>
                  </article>
                </>
              ) : null}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard eyebrow="Governed Lanes" title="Governed Runtime Lanes">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {providerResult.source === "live_runtime" ? <SourceBadge variant="live" /> : <SourceBadge variant="seeded" />}
            <p className="text-xs text-slate">Active runtime lanes under AI-E governance. All operator controls are lane-scoped and operator-authoritative.</p>
          </div>
          <div className="space-y-4">
            <article className="rounded-[1.5rem] border border-ocean/20 bg-ocean/5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={dashboardState?.governed_runtime_lanes?.scheduler_status.status ?? "no_runnable_lanes"} />
                <StatusBadge status={dashboardState?.governed_runtime_lanes?.resource_status.status ?? "resource_idle"} />
              </div>
              <p className="mt-3 text-sm leading-7 body-muted">{dashboardState?.governed_runtime_lanes?.scheduler_status.explanation ?? "No governed runtime lane schedule is available."}</p>
              <p className="mt-2 text-sm leading-7 body-muted">{dashboardState?.governed_runtime_lanes?.resource_status.explanation ?? "No governed runtime lane resource state is available."}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <p className="text-xs leading-6 text-slate">Tracked lanes: {dashboardState?.governed_runtime_lanes?.sessions.length ?? 0}</p>
                <p className="text-xs leading-6 text-slate">Selected lane: {dashboardState?.governed_runtime_lanes?.selected_session_id ?? "none"}</p>
                <p className="text-xs leading-6 text-slate">CPU: {dashboardState?.governed_runtime_lanes?.total_logical_cpu_units ?? 0} / {dashboardState?.governed_runtime_lanes?.max_logical_cpu_units ?? 0}</p>
                <p className="text-xs leading-6 text-slate">Chains: {dashboardState?.governed_runtime_lanes?.total_active_chains ?? 0} / {dashboardState?.governed_runtime_lanes?.max_concurrent_chains ?? 0}</p>
              </div>
            </article>

            {dashboardState?.governed_runtime_lanes?.conflicts.length ? (
              <article className="rounded-[1.5rem] border border-coral/15 bg-coral/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Conflict safety</p>
                <div className="mt-3 space-y-2">
                  {dashboardState.governed_runtime_lanes.conflicts.map((conflict) => (
                    <p key={conflict.conflict_id} className="text-sm leading-7 body-muted">
                      {conflict.kind}: {conflict.left_session_id} vs {conflict.right_session_id} | {conflict.resolution.replace(/_/g, " ")}
                    </p>
                  ))}
                </div>
              </article>
            ) : null}

            {dashboardState?.governed_runtime_lanes?.coordination_dependencies.length ? (
              <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Coordination dependencies</p>
                <div className="mt-3 space-y-2">
                  {dashboardState.governed_runtime_lanes.coordination_dependencies.map((dependency) => (
                    <p key={`${dependency.source_session_id}-${dependency.target_session_id}-${dependency.relationship}`} className="text-sm leading-7 body-muted">
                      {dependency.source_session_id} {dependency.relationship} {dependency.target_session_id} [{dependency.status}]
                    </p>
                  ))}
                </div>
              </article>
            ) : null}

            <div className="space-y-4">
              {dashboardState?.governed_runtime_lanes?.sessions.length ? dashboardState.governed_runtime_lanes.sessions.map((session) => {
                const mergeTargetSessionId = dashboardState.governed_runtime_lanes?.sessions.find((candidate) => candidate.session_id !== session.session_id)?.session_id ?? null;
                return (
                  <GovernedRuntimeLaneRow
                    key={session.session_id}
                    lane={session}
                    mergeTargetLaneId={mergeTargetSessionId}
                    onPause={() => handleAction({ type: "pause_governed_lane", session_id: session.session_id })}
                    onResume={() => handleAction({ type: "resume_governed_lane", session_id: session.session_id })}
                    onTerminate={() => handleAction({ type: "terminate_governed_lane", session_id: session.session_id })}
                    onPromote={(priority) => handleAction({ type: "reprioritize_governed_lane", session_id: session.session_id, session_priority: priority })}
                    onMerge={() => handleAction({ type: "merge_governed_lanes", session_id: session.session_id, target_session_id: mergeTargetSessionId })}
                    disabled={isPending}
                  />
                );
              }) : <p className="text-sm leading-7 body-muted">No governed runtime lanes are currently registered.</p>}
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Operator Summary" title="Approvals, Blockers & Next Action">
          <div className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate">Approvals Required ({dashboardState?.approvals_required.length ?? 0})</p>
              <div className="mt-3 space-y-2">
                {dashboardState?.approvals_required.length ? dashboardState.approvals_required.map((approval) => (
                  <div key={`${approval.goal_id ?? "global"}-${approval.reason}`} className="flex flex-wrap items-center justify-between gap-3 rounded-[1.25rem] border border-amber-200 bg-amber-50/70 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{approval.goal_id ?? "Global approval refresh"}</p>
                      <p className="mt-1 text-xs text-slate">{approval.reason}</p>
                    </div>
                    <ActionButton label="Approve" onClick={() => handleAction({ type: "approve_goal", goal_id: approval.goal_id })} disabled={isPending} tone="accent" />
                  </div>
                )) : <p className="text-sm leading-7 body-muted">No approvals are currently pending.</p>}
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate">Blocked Goals ({dashboardState?.blocked_goals.length ?? 0})</p>
              <div className="mt-3 space-y-2">
                {dashboardState?.blocked_goals.length ? dashboardState.blocked_goals.slice(0, 3).map((goal) => (
                  <div key={goal.goal_id} className="rounded-[1.25rem] border border-coral/15 bg-coral/5 px-4 py-3">
                    <p className="text-sm font-semibold text-ink">{goal.description}</p>
                    <p className="mt-1 text-xs text-slate">{goal.explanation}</p>
                  </div>
                )) : <p className="text-sm leading-7 body-muted">No blocked goals.</p>}
              </div>
            </div>

            {studioOperations?.recommended_operator_actions[0] ? (
              <div className="rounded-[1.25rem] border border-ocean/20 bg-ocean/5 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Next Recommended Action</p>
                <p className="mt-2 text-sm font-semibold text-ink">{studioOperations.recommended_operator_actions[0].action.replace(/_/g, " ")}</p>
                <p className="mt-1 text-xs text-slate">{studioOperations.recommended_operator_actions[0].reason}</p>
              </div>
            ) : null}

            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate">Recent Activity</p>
              <div className="mt-3 space-y-2">
                {dashboardState?.runtime_observability?.event_log.length ? dashboardState.runtime_observability.event_log.slice(-3).reverse().map((event) => (
                  <article key={event.event_id} className="rounded-[1.25rem] border border-ink/10 bg-white/80 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={event.status} />
                      <p className="text-xs text-slate">{event.timestamp}</p>
                    </div>
                    <p className="mt-2 text-sm leading-7 body-muted">{describeRuntimeEvent(event)}</p>
                  </article>
                )) : <p className="text-sm leading-7 body-muted">No recent runtime activity recorded.</p>}
              </div>
            </div>
          </div>
        </SectionCard>

        <div className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-ink/10 bg-white/60 px-6 py-4">
          <div>
            <p className="text-sm font-semibold text-ink">Advanced / Legacy Sections</p>
            <p className="mt-1 text-xs text-slate">
              {showAdvanced
                ? "Showing all sections: Governed Operations Preview, Studio, Meta-Intelligence, Strategy, Chat, session controls, execution chains, and full runtime timeline."
                : "Studio, Meta-Intelligence, Strategy, Chat, session controls, execution chains, and all legacy sections are hidden. Toggle to expand."}
            </p>
          </div>
          <ActionButton label={showAdvanced ? "Hide Advanced" : "Show Advanced / Legacy"} onClick={() => { setShowAdvanced(!showAdvanced); }} disabled={false} />
        </div>

        {showAdvanced ? (
          <>

        <SectionCard eyebrow="Governed Preview" title="Governed Operations">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SourceBadge variant="governed_preview" />
            {providerResult.source === "demo_seed" ? <SourceBadge variant="seeded" /> : null}
          </div>
          <p className="mb-5 text-sm leading-7 body-muted">
            This view shows how AI-E governs registered operation lanes. Each lane is sandbox-isolated, execution-blocked, and requires explicit operator approval before any runtime is permitted to proceed. Runtimes do the bounded work — AI-E governs the work.
            {providerResult.source === "demo_seed" ? " The data below is seeded demo state — not connected to live runtime." : ""}
          </p>
          <GovernedOperationsDashboard viewModel={createSeededGovernedOperationsDashboardViewModel()} />
        </SectionCard>

        <SectionCard eyebrow="Studio" title="Studio Command Center">
          {studioOperations ? (
            <div className="space-y-6">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <StudioMetricCard
                  label="Studio Status"
                  value={studioOperations.studio_status.replace(/_/g, " ")}
                  detail={`Health score ${studioOperations.health_score} with ${studioOperations.resource_pressure} resource pressure.`}
                />
                <StudioMetricCard
                  label="Sessions"
                  value={`${studioOperations.active_session_count}`}
                  detail={`${studioOperations.blocked_session_count} blocked • ${studioOperations.paused_session_count} paused`}
                />
                <StudioMetricCard
                  label="Review Queue"
                  value={`${studioOperations.pending_review_count}`}
                  detail={`${studioOperations.pending_delivery_count} pending deliveries and ${studioOperations.active_delivery_count} active delivery items.`}
                />
                <StudioMetricCard
                  label="Execution Chains"
                  value={`${studioOperations.active_chain_count}`}
                  detail={`${studioOperations.blocked_chain_count} blocked chains currently need attention.`}
                />
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                <div className="space-y-4 rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Top Risks</p>
                      <h3 className="headline mt-2 text-xl font-semibold text-ink">Whole-system health at a glance.</h3>
                    </div>
                    <StatusBadge status={studioOperations.resource_pressure} />
                  </div>
                  <div className="space-y-3">
                    {studioOperations.recent_risks.length > 0 ? studioOperations.recent_risks.map((risk) => (
                      <article key={risk.id} className="rounded-[1.25rem] border border-ink/10 bg-white p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={risk.severity} />
                          <p className="text-xs uppercase tracking-[0.18em] text-slate">{risk.source.replace(/_/g, " ")}</p>
                        </div>
                        <p className="mt-3 text-sm leading-7 body-muted">{risk.summary}</p>
                      </article>
                    )) : <p className="text-sm leading-7 body-muted">No studio risks are currently recorded.</p>}
                  </div>
                </div>

                <div className="space-y-4 rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Recommended Operator Actions</p>
                    <h3 className="headline mt-2 text-xl font-semibold text-ink">Safe command-center controls.</h3>
                  </div>
                  <div className="space-y-3">
                    {studioOperations.recommended_operator_actions.length > 0 ? studioOperations.recommended_operator_actions.map((item) => (
                      <article key={item.action} className="rounded-[1.25rem] border border-ink/10 bg-white p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={item.priority} />
                          <p className="text-xs uppercase tracking-[0.18em] text-slate">{item.action.replace(/_/g, " ")}</p>
                        </div>
                        <p className="mt-3 text-sm leading-7 body-muted">{item.reason}</p>
                      </article>
                    )) : <p className="text-sm leading-7 body-muted">No recommended operator actions are currently recorded.</p>}
                  </div>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Priority Work</p>
                  <div className="mt-4 space-y-3">
                    {studioOperations.top_priority_work.length > 0 ? studioOperations.top_priority_work.map((item) => (
                      <article key={`${item.kind}-${item.id}`} className="rounded-[1.25rem] border border-ink/10 bg-white p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={item.priority} />
                          <StatusBadge status={item.status} />
                          <p className="text-xs uppercase tracking-[0.18em] text-slate">{item.kind}</p>
                        </div>
                        <h3 className="headline mt-3 text-lg font-semibold text-ink">{item.title}</h3>
                        <p className="mt-2 text-sm leading-7 body-muted">{item.summary}</p>
                      </article>
                    )) : <p className="text-sm leading-7 body-muted">No priority work is currently active.</p>}
                  </div>
                </section>

                <section className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Command Center Controls</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ActionButton label="Pause All Sessions" onClick={() => handleAction({ type: "pause_all_sessions" })} disabled={isPending} tone="warning" />
                    <ActionButton label="Resume Safe Sessions" onClick={() => handleAction({ type: "resume_safe_sessions" })} disabled={isPending} tone="accent" />
                    <ActionButton label="Prioritize Review Queue" onClick={() => handleAction({ type: "prioritize_review_queue" })} disabled={isPending} />
                    <ActionButton label="Prioritize Delivery Queue" onClick={() => handleAction({ type: "prioritize_delivery_queue" })} disabled={isPending} />
                    <ActionButton label="Acknowledge Studio Risk" onClick={() => handleAction({ type: "acknowledge_studio_risk" })} disabled={isPending} />
                    <ActionButton label="Request Studio Summary" onClick={() => handleAction({ type: "request_studio_summary" })} disabled={isPending} />
                  </div>
                  <p className="mt-4 text-sm leading-7 body-muted">
                    These controls are operator-gated. They only reprioritize, pause, resume, acknowledge, or summarize persisted runtime state and do not trigger hidden execution.
                  </p>
                  <p className="mt-3 text-xs text-slate">
                    Risk acknowledgements: {dashboardState?.studio_risk_acknowledgements?.length ?? 0}
                    {dashboardState?.studio_risk_acknowledgements?.[0]?.acknowledged_at ? ` • Latest at ${dashboardState.studio_risk_acknowledgements[0].acknowledged_at}` : ""}
                  </p>
                  {dashboardState?.studio_summary_package ? (
                    <article className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="headline text-lg font-semibold text-ink">Studio Summary</h3>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate">Requested {dashboardState.studio_summary_package.requested_at}</p>
                      </div>
                      <p className="mt-3 text-sm leading-7 body-muted">{dashboardState.studio_summary_package.narrative}</p>
                      <p className="mt-3 text-xs text-slate">Next action: {dashboardState.studio_summary_package.recommended_next_operator_action.replace(/_/g, " ")}</p>
                      <p className="mt-1 text-xs text-slate">Latest validation/proof: {dashboardState.studio_summary_package.latest_validation_status ?? "none recorded"}</p>
                    </article>
                  ) : null}
                </section>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-7 body-muted">Studio command-center health is not available for the current operator state source.</p>
          )}
        </SectionCard>

        <SectionCard eyebrow="0.5" title="Meta-Intelligence">
          {metaIntelligence ? (
            <div className="space-y-6">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <StudioMetricCard
                  label="Observed Sessions"
                  value={`${metaIntelligence.total_sessions}`}
                  detail={`${metaIntelligence.successful_sessions} successful • ${metaIntelligence.blocked_sessions} blocked`}
                />
                <StudioMetricCard
                  label="Proof + Trace Failures"
                  value={`${metaIntelligence.proof_failure_count + metaIntelligence.trace_failure_count}`}
                  detail={`${metaIntelligence.proof_failure_count} proof • ${metaIntelligence.trace_failure_count} trace`}
                />
                <StudioMetricCard
                  label="Operator Interventions"
                  value={`${metaIntelligence.operator_intervention_count}`}
                  detail={`${metaIntelligence.recovery_event_count} recovery events and ${metaIntelligence.resource_pressure_events} resource pressure signals.`}
                />
                <StudioMetricCard
                  label="Avg Completion"
                  value={`${metaIntelligence.average_ticks_to_completion}`}
                  detail={`Average review delay ${metaIntelligence.average_review_delay}h in the current observed window.`}
                />
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <section className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Detected Patterns</p>
                      <h3 className="headline mt-2 text-xl font-semibold text-ink">Recurring operational behavior.</h3>
                    </div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Window ends {metaIntelligence.observed_window_end}</p>
                  </div>
                  <div className="mt-4 space-y-3">
                    {dashboardState?.meta_detected_patterns?.length ? dashboardState.meta_detected_patterns.map((pattern) => (
                      <article key={pattern.pattern_id} className="rounded-[1.25rem] border border-ink/10 bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={pattern.severity} />
                            <p className="text-xs uppercase tracking-[0.18em] text-slate">{pattern.category.replace(/_/g, " ")}</p>
                          </div>
                          <ActionButton
                            label="Acknowledge"
                            onClick={() => handleAction({ type: "acknowledge_pattern", pattern_id: pattern.pattern_id })}
                            disabled={isPending}
                          />
                        </div>
                        <p className="mt-3 text-sm leading-7 body-muted">{pattern.summary}</p>
                        <p className="mt-3 text-xs text-slate">Recommended action: {pattern.recommended_action.replace(/_/g, " ")}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {pattern.evidence.slice(0, 3).map((item) => (
                            <span key={item} className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-slate">{item}</span>
                          ))}
                        </div>
                      </article>
                    )) : <p className="text-sm leading-7 body-muted">No recurring meta-intelligence patterns are recorded yet.</p>}
                  </div>
                </section>

                <section className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Persisted Policy State</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <SupervisedSessionField label="Concurrency" value={metaPolicyState?.concurrency_mode ?? "not set"} />
                    <SupervisedSessionField label="Tick Budget" value={metaPolicyState?.tick_budget_mode ?? "not set"} />
                    <SupervisedSessionField label="Review Timing" value={metaPolicyState?.review_timing_mode ?? "not set"} />
                    <SupervisedSessionField label="Checkpoint Frequency" value={metaPolicyState?.checkpoint_frequency_mode ?? "not set"} />
                    <SupervisedSessionField label="Proof Timeout" value={metaPolicyState?.proof_timeout_mode ?? "not set"} />
                    <SupervisedSessionField label="Resource Safe Mode" value={String(metaPolicyState?.resource_safe_mode_enabled ?? false)} />
                  </div>
                  <p className="mt-4 text-xs text-slate">Paused agent roles: {metaPolicyState?.paused_agent_roles.length ? metaPolicyState.paused_agent_roles.join(", ") : "none"}</p>
                </section>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Policy Recommendations</p>
                      <h3 className="headline mt-2 text-xl font-semibold text-ink">Advisory changes only.</h3>
                    </div>
                    <ActionButton label="Request Meta Summary" onClick={() => handleAction({ type: "request_meta_summary" })} disabled={isPending} />
                  </div>
                  <div className="mt-4 space-y-3">
                    {dashboardState?.meta_policy_recommendations?.length ? dashboardState.meta_policy_recommendations.map((item) => (
                      <article key={item.recommendation_id} className="rounded-[1.25rem] border border-ink/10 bg-white p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={item.impact} />
                          <StatusBadge status={item.status} />
                          <p className="text-xs uppercase tracking-[0.18em] text-slate">{item.target.replace(/_/g, " ")}</p>
                        </div>
                        <h3 className="headline mt-3 text-lg font-semibold text-ink">{item.title}</h3>
                        <p className="mt-2 text-sm leading-7 body-muted">{item.summary}</p>
                        <p className="mt-3 text-xs text-slate">Current: {item.current_policy_value}</p>
                        <p className="mt-1 text-xs text-slate">Requested: {item.requested_policy_value}</p>
                        <p className="mt-3 text-xs text-slate">{item.safe_rationale}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <ActionButton
                            label="Approve"
                            onClick={() => handleAction({ type: "approve_policy_recommendation", recommendation_id: item.recommendation_id })}
                            disabled={isPending || item.status === "approved"}
                            tone="accent"
                          />
                          <ActionButton
                            label="Reject"
                            onClick={() => handleAction({ type: "reject_policy_recommendation", recommendation_id: item.recommendation_id })}
                            disabled={isPending || item.status === "rejected"}
                            tone="warning"
                          />
                          <ActionButton
                            label="Defer"
                            onClick={() => handleAction({ type: "defer_policy_recommendation", recommendation_id: item.recommendation_id })}
                            disabled={isPending || item.status === "deferred"}
                          />
                        </div>
                      </article>
                    )) : <p className="text-sm leading-7 body-muted">No bounded policy recommendation is currently waiting for review.</p>}
                  </div>
                </section>

                <section className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Meta Summary Package</p>
                  {dashboardState?.meta_summary_package ? (
                    <article className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Requested {dashboardState.meta_summary_package.requested_at}</p>
                      <p className="mt-3 text-sm leading-7 body-muted">{dashboardState.meta_summary_package.narrative}</p>
                      <p className="mt-4 text-xs uppercase tracking-[0.18em] text-slate">Recommended Changes</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {dashboardState.meta_summary_package.recommended_changes.map((item) => (
                          <span key={item} className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-slate">{item}</span>
                        ))}
                      </div>
                      <p className="mt-4 text-xs uppercase tracking-[0.18em] text-slate">Must Not Change</p>
                      <div className="mt-2 space-y-2">
                        {dashboardState.meta_summary_package.should_not_change.map((item) => (
                          <p key={item} className="text-sm leading-7 body-muted">{item}</p>
                        ))}
                      </div>
                    </article>
                  ) : (
                    <p className="mt-4 text-sm leading-7 body-muted">No meta summary has been requested yet.</p>
                  )}
                  <p className="mt-4 text-xs text-slate">Operator decisions recorded: {dashboardState?.meta_operator_decision_history?.length ?? 0}</p>
                </section>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-7 body-muted">Meta-intelligence state is not available for the current operator state source.</p>
          )}
        </SectionCard>

        <SectionCard eyebrow="0.75" title="Strategy Portfolio">
          {strategyGoals.length ? (
            <div className="space-y-6">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <StudioMetricCard label="Proposed Strategic Goals" value={`${proposedStrategyGoals.length}`} detail={`${approvedStrategyGoals.length} approved awaiting activation, ${activeStrategyGoals.length} active or paused, and ${blockedStrategyGoals.length} blocked.`} />
                <StudioMetricCard label="Top Portfolio Score" value={`${strategyScores[0]?.score_breakdown.total ?? 0}`} detail={strategyScores[0] ? `${strategyGoals.find((goal) => goal.strategy_goal_id === strategyScores[0]?.strategy_goal_id)?.title ?? strategyScores[0].strategy_goal_id}` : "No ranked strategy goals yet."} />
                <StudioMetricCard label="Linked Work Items" value={`${strategyGoals.reduce((total, goal) => total + goal.linked_work_item_ids.length, 0)}`} detail={`${dashboardState?.strategy_decompositions?.length ?? 0} decompositions have been recorded.`} />
                <StudioMetricCard label="Decisions Needed" value={`${dashboardState?.strategy_summary_package?.operator_decisions_needed.length ?? 0}`} detail={`${completedStrategyGoals.length} completed, rejected, or archived.`} />
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                <section className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Portfolio Overview</p>
                      <h3 className="headline mt-2 text-xl font-semibold text-ink">Strategic goals across the studio.</h3>
                    </div>
                    <ActionButton label="Request Strategy Summary" onClick={() => handleAction({ type: "request_strategy_summary" })} disabled={isPending} />
                  </div>
                  <div className="mt-4 space-y-4">
                    {[...proposedStrategyGoals, ...approvedStrategyGoals, ...activeStrategyGoals, ...blockedStrategyGoals, ...completedStrategyGoals]
                      .filter((goal, index, array) => array.findIndex((candidate) => candidate.strategy_goal_id === goal.strategy_goal_id) === index)
                      .map((goal) => (
                        <StrategyGoalRow
                          key={goal.strategy_goal_id}
                          goal={goal}
                          score={strategyScoreMap.get(goal.strategy_goal_id) ?? null}
                          onApprove={() => handleAction({ type: "approve_strategy_goal", goal_id: goal.strategy_goal_id })}
                          onReject={() => handleAction({ type: "reject_strategy_goal", goal_id: goal.strategy_goal_id })}
                          onDefer={() => handleAction({ type: "defer_strategy_goal", goal_id: goal.strategy_goal_id })}
                          onActivate={() => handleAction({ type: "activate_strategy_goal", goal_id: goal.strategy_goal_id })}
                          onPause={() => handleAction({ type: "pause_strategy_goal", goal_id: goal.strategy_goal_id })}
                          onArchive={() => handleAction({ type: "archive_strategy_goal", goal_id: goal.strategy_goal_id })}
                          onDecompose={() => handleAction({ type: "decompose_strategy_goal", goal_id: goal.strategy_goal_id })}
                          disabled={isPending}
                        />
                      ))}
                  </div>
                </section>

                <section className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Strategy Summary Package</p>
                  {dashboardState?.strategy_summary_package ? (
                    <article className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate">Requested {dashboardState.strategy_summary_package.requested_at}</p>
                      <p className="mt-3 text-sm leading-7 body-muted">{dashboardState.strategy_summary_package.rationale}</p>
                      <p className="mt-3 text-xs text-slate">Top recommended goal: {dashboardState.strategy_summary_package.top_recommended_goal ?? "none"}</p>
                      <p className="mt-1 text-xs text-slate">Best next objective: {dashboardState.strategy_summary_package.best_next_objective ?? "none"}</p>
                      <p className="mt-4 text-xs uppercase tracking-[0.18em] text-slate">Current Strategic Goals</p>
                      <div className="mt-2 space-y-2">
                        {dashboardState.strategy_summary_package.current_strategic_goals.map((item) => (
                          <p key={item} className="text-sm leading-7 body-muted">{item}</p>
                        ))}
                      </div>
                      <p className="mt-4 text-xs uppercase tracking-[0.18em] text-slate">Operator Decisions Needed</p>
                      <div className="mt-2 space-y-2">
                        {dashboardState.strategy_summary_package.operator_decisions_needed.length ? dashboardState.strategy_summary_package.operator_decisions_needed.map((item) => (
                          <p key={item} className="text-sm leading-7 body-muted">{item}</p>
                        )) : <p className="text-sm leading-7 body-muted">No operator strategy decisions are currently pending.</p>}
                      </div>
                      <p className="mt-4 text-xs uppercase tracking-[0.18em] text-slate">Suggested Decomposition</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {dashboardState.strategy_summary_package.suggested_decomposition.length ? dashboardState.strategy_summary_package.suggested_decomposition.map((item) => (
                          <span key={item} className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-slate">{item}</span>
                        )) : <p className="text-sm leading-7 body-muted">No decomposition has been requested yet.</p>}
                      </div>
                    </article>
                  ) : (
                    <p className="mt-4 text-sm leading-7 body-muted">No strategy summary has been requested yet.</p>
                  )}
                </section>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-7 body-muted">Strategy portfolio data is not available for the current operator state source.</p>
          )}
        </SectionCard>

        <SectionCard eyebrow="0.9" title="AI-E Chat">
          <div className="space-y-6">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StudioMetricCard
                label="Session Status"
                value={chatSession?.status.replace(/_/g, " ") ?? "unavailable"}
                detail={chatSession?.operator_notice ?? "Chat is unavailable for the current operator state source."}
              />
              <StudioMetricCard
                label="Messages"
                value={`${chatSession?.messages.length ?? 0}`}
                detail={`${chatSession?.pending_options.length ?? 0} pending operator options and ${chatSession?.latest_proposal ? 1 : 0} active proposal.`}
              />
              <StudioMetricCard
                label="Readiness"
                value={chatSession?.last_readiness_status?.replace(/_/g, " ") ?? "none"}
                detail={chatSession?.last_refinement_summary ?? "No conversational routing result has been recorded yet."}
              />
              <StudioMetricCard
                label="Boundary"
                value="Advisory"
                detail="This panel clarifies requests and proposes bounded next steps. It does not execute runtime work."
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <section className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Conversational Intake</p>
                    <h3 className="headline mt-2 text-xl font-semibold text-ink">Reception, not execution.</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      label="Request Chat Summary"
                      onClick={() => handleAction({ type: "request_chat_summary" })}
                      disabled={isPending || !chatSession}
                    />
                    <ActionButton
                      label="Archive Session"
                      onClick={() => handleAction({ type: "archive_chat_session" })}
                      disabled={isPending || !chatSession || chatSession.status === "archived"}
                      tone="warning"
                    />
                  </div>
                </div>
                <p className="mt-4 text-sm leading-7 body-muted">
                  Chat can narrow intent, surface follow-up questions, and propose a safe routing target. Every outcome stays operator-gated and advisory until you explicitly move it into the existing pipeline.
                </p>
                <label className="mt-5 flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white p-4 text-sm text-ink">
                  <span className="text-xs uppercase tracking-[0.18em] text-slate">Message to AI-E</span>
                  <textarea
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    rows={4}
                    placeholder="Describe the task, constraint, or ambiguity you want AI-E to route safely."
                    className="rounded-xl border border-ink/10 bg-white px-3 py-3 text-sm text-ink outline-none"
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionButton
                    label="Submit Chat Message"
                    onClick={() => {
                      const nextMessage = chatInput.trim();
                      if (!nextMessage) {
                        setError("Enter a chat message before submitting it.");
                        return;
                      }
                      handleAction({ type: "submit_chat_message", message_text: nextMessage });
                      setChatInput("");
                    }}
                    disabled={isPending}
                    tone="accent"
                  />
                </div>
              </section>

              <section className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Proposal + Options</p>
                {chatSession?.latest_proposal ? (
                  <article className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={chatSession.latest_proposal.route} />
                      <StatusBadge status={chatSession.latest_proposal.requires_operator_review ? "operator_review" : "operator_gated"} />
                    </div>
                    <h3 className="headline mt-3 text-lg font-semibold text-ink">{chatSession.latest_proposal.title}</h3>
                    <p className="mt-2 text-sm leading-7 body-muted">{chatSession.latest_proposal.summary}</p>
                    <p className="mt-3 text-xs text-slate">Planner-ready request: {chatSession.latest_proposal.planner_ready_request ?? "not ready yet"}</p>
                    <p className="mt-1 text-xs text-slate">Safe to execute directly: no</p>
                  </article>
                ) : (
                  <p className="mt-4 text-sm leading-7 body-muted">No conversational proposal has been recorded yet.</p>
                )}

                <div className="mt-5 space-y-3">
                  {chatSession?.pending_options.length ? chatSession.pending_options.map((option) => (
                    <article key={option.option_id} className="rounded-[1.25rem] border border-ink/10 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-ink">{option.label}</p>
                          <p className="mt-2 text-sm leading-7 body-muted">{option.description}</p>
                        </div>
                        <ActionButton
                          label="Select"
                          onClick={() => handleAction({ type: "select_chat_option", option_id: option.option_id })}
                          disabled={isPending}
                        />
                      </div>
                    </article>
                  )) : <p className="text-sm leading-7 body-muted">No operator chat options are waiting right now.</p>}
                </div>
              </section>
            </div>

            <section className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Conversation Log</p>
                  <h3 className="headline mt-2 text-xl font-semibold text-ink">Persisted advisory history.</h3>
                </div>
                <p className="text-xs text-slate">{chatSession?.operator_notice ?? "No active conversational notice."}</p>
              </div>
              <div className="mt-4 space-y-3">
                {chatSession?.messages.length ? chatSession.messages.slice(-8).map((entry) => (
                  <ChatMessageRow
                    key={entry.message_id}
                    role={entry.role}
                    kind={entry.kind}
                    content={entry.content}
                    createdAt={entry.created_at}
                  />
                )) : <p className="text-sm leading-7 body-muted">No conversational messages are recorded yet.</p>}
              </div>
              {chatSession?.last_summary ? (
                <article className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Latest Chat Summary</p>
                  <p className="mt-3 text-sm leading-7 body-muted">{chatSession.last_summary}</p>
                </article>
              ) : null}
            </section>
          </div>
        </SectionCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard eyebrow="1" title="Active Goal">
            {dashboardState?.active_goal ? (
              <GoalRow goal={dashboardState.active_goal}>
                <ActionButton
                  label="Pause"
                  onClick={() => handleAction({ type: "pause_goal", goal_id: dashboardState.active_goal?.goal_id ?? null })}
                  disabled={isPending}
                  tone="warning"
                />
              </GoalRow>
            ) : (
              <p className="text-sm leading-7 body-muted">No goal currently owns the active slot.</p>
            )}
          </SectionCard>

          <SectionCard eyebrow="2" title="Goal Queue">
            <div className="space-y-4">
              {dashboardState?.queued_goals.length ? dashboardState.queued_goals.map((goal) => (
                <GoalRow key={goal.goal_id} goal={goal} />
              )) : <p className="text-sm leading-7 body-muted">No queued goals.</p>}
              <div className="border-t border-ink/10 pt-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Paused goals</p>
                <div className="mt-3 space-y-4">
                  {dashboardState?.paused_goals.length ? dashboardState.paused_goals.map((goal) => (
                    <GoalRow key={goal.goal_id} goal={goal}>
                      <ActionButton
                        label="Resume"
                        onClick={() => handleAction({ type: "resume_goal", goal_id: goal.goal_id })}
                        disabled={isPending}
                        tone="accent"
                      />
                    </GoalRow>
                  )) : <p className="text-sm leading-7 body-muted">No paused goals.</p>}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard eyebrow="3" title="Blocked Goals">
            <div className="space-y-4">
              {dashboardState?.blocked_goals.length ? dashboardState.blocked_goals.map((goal) => (
                <BlockedGoalRow
                  key={goal.goal_id}
                  goal={goal}
                  onRetry={() => handleAction({ type: "retry_goal", goal_id: goal.goal_id })}
                  disabled={isPending}
                />
              )) : <p className="text-sm leading-7 body-muted">No blocked goals.</p>}
            </div>
          </SectionCard>

          <SectionCard eyebrow="4" title="Recovery Recommendations">
            <div className="space-y-4">
              {dashboardState?.recovery_recommendations.length ? dashboardState.recovery_recommendations.map((recommendation) => (
                <RecoveryRow
                  key={recommendation.report_id}
                  recommendation={recommendation}
                  blockedGoal={firstBlockedGoal}
                  onRetry={() => handleAction({ type: "retry_goal", goal_id: firstBlockedGoal?.goal_id ?? null })}
                  disabled={isPending || !firstBlockedGoal}
                />
              )) : <p className="text-sm leading-7 body-muted">No recovery recommendations are currently active.</p>}
            </div>
          </SectionCard>

          <SectionCard eyebrow="5" title="Approvals Required">
            <div className="space-y-4">
              {dashboardState?.approvals_required.length ? dashboardState.approvals_required.map((approval) => (
                <ApprovalRow
                  key={`${approval.goal_id ?? "global"}-${approval.reason}`}
                  approval={approval}
                  onApprove={() => handleAction({ type: "approve_goal", goal_id: approval.goal_id })}
                  disabled={isPending}
                />
              )) : <p className="text-sm leading-7 body-muted">No approvals are currently pending.</p>}
            </div>
          </SectionCard>

          <SectionCard eyebrow="6" title="Runtime Status">
            <div className="space-y-4">
              <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={dashboardState?.runtime_status.status ?? "unavailable"} />
                  <StatusBadge status={dashboardState?.session_status.status ?? "unavailable"} />
                  <StatusBadge status={dashboardState?.scheduler_status.status ?? "unavailable"} />
                </div>
                <p className="mt-3 text-sm leading-7 body-muted">{dashboardState?.runtime_status.explanation ?? "No runtime state is available."}</p>
                <p className="mt-2 text-sm leading-7 body-muted">{dashboardState?.session_status.explanation ?? "No session state is available."}</p>
                <p className="mt-2 text-sm leading-7 body-muted">{dashboardState?.scheduler_status.explanation ?? "No scheduler state is available."}</p>
              </article>
            </div>
          </SectionCard>

          <SectionCard eyebrow="6A" title="Governed Work Planning">
            <div className="space-y-4">
              <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Planning policy feedback</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <p className="text-xs leading-6 text-slate">Approvals: {dashboardState?.planning_policy_feedback?.approvals_recorded ?? 0}</p>
                  <p className="text-xs leading-6 text-slate">Rejections: {dashboardState?.planning_policy_feedback?.rejections_recorded ?? 0}</p>
                  <p className="text-xs leading-6 text-slate">Deferrals: {dashboardState?.planning_policy_feedback?.deferrals_recorded ?? 0}</p>
                  <p className="text-xs leading-6 text-slate">Last feedback: {dashboardState?.planning_policy_feedback?.last_feedback_at ?? "none"}</p>
                </div>
                <div className="mt-4 space-y-2">
                  {(dashboardState?.planning_recommendations ?? []).slice(0, 3).map((recommendation) => (
                    <p key={recommendation.work_item_id} className="text-sm leading-7 body-muted">
                      {recommendation.title}: score {recommendation.score} | {recommendation.explanation}
                    </p>
                  ))}
                </div>
              </article>

              <div className="space-y-4">
                {dashboardState?.proposed_work_items?.length ? dashboardState.proposed_work_items.map((item) => (
                  <WorkItemRow
                    key={item.work_item_id}
                    item={item}
                    onApprove={() => handleAction({ type: "approve_work_item", work_item_id: item.work_item_id })}
                    onReject={() => handleAction({ type: "reject_work_item", work_item_id: item.work_item_id })}
                    onDefer={() => handleAction({ type: "defer_work_item", work_item_id: item.work_item_id })}
                    disabled={isPending}
                  />
                )) : <p className="text-sm leading-7 body-muted">No proposed work items are waiting for operator review.</p>}
              </div>

              <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Scheduled and running work</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Scheduled</p>
                    <div className="mt-2 space-y-2">
                      {dashboardState?.scheduled_work_items?.length ? dashboardState.scheduled_work_items.map((item) => (
                        <p key={item.work_item_id} className="text-sm leading-7 body-muted">{item.title} [{item.status}]</p>
                      )) : <p className="text-sm leading-7 body-muted">No scheduled work items.</p>}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate">Running</p>
                    <div className="mt-2 space-y-2">
                      {dashboardState?.running_work_items?.length ? dashboardState.running_work_items.map((item) => (
                        <p key={item.work_item_id} className="text-sm leading-7 body-muted">{item.title} [{item.status}]</p>
                      )) : <p className="text-sm leading-7 body-muted">No running work items.</p>}
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </SectionCard>

          <SectionCard eyebrow="6B" title="Review Packages">
            <div className="space-y-4">
              {dashboardState?.review_packages?.length ? dashboardState.review_packages.map((item) => (
                <ReviewPackageRow
                  key={item.package_id}
                  item={item}
                  onApprove={() => handleAction({ type: "approve_review_package", package_id: item.package_id })}
                  onReject={() => handleAction({ type: "reject_review_package", package_id: item.package_id })}
                  disabled={isPending}
                />
              )) : <p className="text-sm leading-7 body-muted">No review packages are waiting for operator decision.</p>}
            </div>
          </SectionCard>

          <SectionCard eyebrow="6C" title="Delivery Pipeline">
            <div className="space-y-4">
              {dashboardState?.delivery_packages?.length ? dashboardState.delivery_packages.map((item) => (
                <DeliveryPackageRow
                  key={item.delivery_package_id}
                  item={item}
                  onApproveForCommit={() => handleAction({ type: "approve_delivery_package", package_id: item.delivery_package_id })}
                  onRejectDelivery={() => handleAction({ type: "reject_delivery_package", package_id: item.delivery_package_id })}
                  onRequestChanges={() => handleAction({ type: "request_delivery_changes", package_id: item.delivery_package_id })}
                  onArchive={() => handleAction({ type: "archive_delivery_package", package_id: item.delivery_package_id })}
                  disabled={isPending}
                />
              )) : <p className="text-sm leading-7 body-muted">No delivery packages are waiting for operator approval.</p>}
            </div>
          </SectionCard>

          <SectionCard eyebrow="7" title="Runtime Introspection">
            <div className="grid gap-4 md:grid-cols-2">
              <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Current tick</p>
                <p className="mt-2 text-2xl font-semibold text-ink">{dashboardState?.runtime_observability?.current_tick ?? 0}</p>
                <p className="mt-3 text-sm leading-7 body-muted">Last tick at: {dashboardState?.runtime_observability?.last_tick_at ?? "none"}</p>
                <p className="mt-2 text-sm leading-7 body-muted">Next scheduled tick: {dashboardState?.runtime_observability?.next_scheduled_tick_at ?? "none"}</p>
              </article>
              <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate">Last mutation</p>
                <p className="mt-2 text-sm leading-7 body-muted">{dashboardState?.runtime_observability?.last_mutation ?? "No runtime mutation has been persisted yet."}</p>
                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate">Last semantic transition</p>
                <p className="mt-2 text-sm leading-7 body-muted">{dashboardState?.runtime_observability?.last_semantic_transition ?? "No semantic transition has been recorded yet."}</p>
                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate">Latest safety gate decision</p>
                <p className="mt-2 text-sm leading-7 body-muted">{formatSafetyGateDecision(dashboardState?.runtime_observability?.latest_safety_gate_decision)}</p>
                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate">Next scheduled action</p>
                <p className="mt-2 text-sm leading-7 body-muted">{dashboardState?.runtime_observability?.next_scheduled_action ?? "No further bounded action is currently scheduled."}</p>
              </article>
            </div>
          </SectionCard>

          <SectionCard eyebrow="8" title="Agent Runtime">
            <div className="space-y-4">
              <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <p className="text-xs leading-6 text-slate">Active agents: {dashboardState?.agent_runtime?.active_agents.length ?? 0}</p>
                  <p className="text-xs leading-6 text-slate">Idle agents: {dashboardState?.agent_runtime?.idle_agents.length ?? 0}</p>
                  <p className="text-xs leading-6 text-slate">Blocked agents: {dashboardState?.agent_runtime?.blocked_agents.length ?? 0}</p>
                  <p className="text-xs leading-6 text-slate">Paused agents: {dashboardState?.agent_runtime?.paused_agents.length ?? 0}</p>
                </div>
              </article>
              {dashboardState?.agent_runtime?.agents.length ? dashboardState.agent_runtime.agents.map((agent) => (
                <AgentRuntimeRow key={agent.agent_id} agent={agent} />
              )) : <p className="text-sm leading-7 body-muted">No agent runtime state has been recorded yet.</p>}
            </div>
          </SectionCard>

          <SectionCard eyebrow="Supervised Session" title="Supervised Session Controls">
            <div className="space-y-4">
              <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={activeSession?.status ?? "not_started"} />
                  <StatusBadge status={activeSession?.approval_policy ?? "approval_policy_unset"} />
                  <StatusBadge status={latestCheckpoint?.safety_status ?? (activeSession?.pending_operator_review ? "review_required" : "not_started")} />
                </div>
                <p className="mt-3 text-sm leading-7 body-muted">
                  {activeSession
                    ? `Session ${activeSession.session_id} is ${activeSession.status.replace(/_/g, " ")} with ${activeSession.ticks_completed}/${activeSession.tick_budget} ticks consumed.`
                    : "No supervised autonomy session is currently configured."}
                </p>
              </article>

              <div className="grid gap-4 md:grid-cols-2">
                <SessionInput label="Max Duration (hours)" value={maxDurationHours} onChange={setMaxDurationHours} />
                <SessionInput label="Tick Budget" value={tickBudget} onChange={setTickBudget} />
                <SessionInput label="Max Chain Count" value={maxChainCount} onChange={setMaxChainCount} />
                <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm text-ink">
                  <span className="text-xs uppercase tracking-[0.18em] text-slate">Approval Policy</span>
                  <select
                    value={approvalPolicy ?? "operator_must_approve_start"}
                    onChange={(event) => setApprovalPolicy(event.target.value as SupervisedSessionControlInput["approval_policy"])}
                    className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none"
                  >
                    <option value="operator_must_approve_start">operator_must_approve_start</option>
                    <option value="operator_must_approve_sensitive">operator_must_approve_sensitive</option>
                    <option value="preapproved_with_limits">preapproved_with_limits</option>
                  </select>
                </label>
                <ToggleInput label="Overnight Mode" checked={overnightModeEnabled} onChange={setOvernightModeEnabled} />
                <ToggleInput label="Review Queue Enabled" checked={reviewQueueEnabled} onChange={setReviewQueueEnabled} />
                <SessionInput label="Allowed Window Start" value={allowedTimeWindowStart} onChange={setAllowedTimeWindowStart} type="text" />
                <SessionInput label="Allowed Window End" value={allowedTimeWindowEnd} onChange={setAllowedTimeWindowEnd} type="text" />
                <SessionInput label="Max Retries Per Chain" value={maxRetriesPerChain} onChange={setMaxRetriesPerChain} />
                <SessionInput label="Max Recovery Attempts" value={maxRecoveryAttempts} onChange={setMaxRecoveryAttempts} />
                <SessionInput label="Checkpoint Interval Ticks" value={checkpointIntervalTicks} onChange={setCheckpointIntervalTicks} />
              </div>

              <div className="flex flex-wrap gap-2">
                <ActionButton
                  label="Start Supervised Session"
                  onClick={() => handleAction({ type: "start_supervised_session", supervised_session_input: buildSupervisedSessionInput() })}
                  disabled={isPending}
                  tone="accent"
                />
                <ActionButton
                  label="Pause Session"
                  onClick={() => handleAction({ type: "pause_session" })}
                  disabled={isPending || !activeSession}
                  tone="warning"
                />
                <ActionButton
                  label="Resume Session"
                  onClick={() => handleAction({ type: "resume_session" })}
                  disabled={isPending || !activeSession}
                  tone="accent"
                />
                <ActionButton
                  label="Stop Session"
                  onClick={() => handleAction({ type: "stop_session" })}
                  disabled={isPending || !activeSession}
                  tone="warning"
                />
                <ActionButton
                  label="Request Operator Review"
                  onClick={() => handleAction({ type: "request_operator_review" })}
                  disabled={isPending || !activeSession}
                />
                <ActionButton
                  label="Start Overnight Session"
                  onClick={() => handleAction({
                    type: "start_supervised_session",
                    supervised_session_input: {
                      ...buildSupervisedSessionInput(),
                      overnight_mode_enabled: true,
                    },
                  })}
                  disabled={isPending}
                  tone="accent"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <SupervisedSessionField label="Elapsed Time" value={activeSession ? `${Math.round(activeSession.duration_ms / 1000)}s` : "none"} />
                <SupervisedSessionField label="Max Duration" value={activeSession ? `${Math.round(activeSession.max_duration_ms / 3_600_000)}h` : `${maxDurationHours}h`} />
                <SupervisedSessionField label="Ticks Completed / Budget" value={activeSession ? `${activeSession.ticks_completed} / ${activeSession.tick_budget}` : `0 / ${tickBudget}`} />
                <SupervisedSessionField label="Active Agents" value={activeSession ? String(activeSession.agent_ids.length) : "0"} />
                <SupervisedSessionField label="Active Chains" value={activeSession ? String(activeSession.active_chain_ids.length) : "0"} />
                <SupervisedSessionField label="Last Checkpoint" value={activeSession?.last_checkpoint_at ?? "none"} />
                <SupervisedSessionField label="Last Recovery Action" value={activeSession?.last_recovery_action ?? "none"} />
                <SupervisedSessionField label="Safety Status" value={latestCheckpoint?.safety_status ?? (activeSession?.pending_operator_review ? "review_required" : "passed") } />
                <SupervisedSessionField label="Next Scheduled Tick" value={activeSession?.next_scheduled_tick_at ?? dashboardState?.runtime_observability?.next_scheduled_tick_at ?? "none"} />
              </div>

              {activeSession?.overnight_policy ? (
                <article className="rounded-[1.5rem] border border-ocean/20 bg-ocean/5 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Overnight Policy</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <SupervisedSessionField label="Runtime Hours" value={String(activeSession.overnight_policy.max_runtime_hours)} />
                    <SupervisedSessionField label="Allowed Window" value={`${activeSession.overnight_policy.allowed_time_window.start_time} - ${activeSession.overnight_policy.allowed_time_window.end_time}`} />
                    <SupervisedSessionField label="Review Queue" value={activeSession.overnight_policy.review_queue_enabled ? "enabled" : "disabled"} />
                    <SupervisedSessionField label="Max Recovery Attempts" value={String(activeSession.overnight_policy.max_recovery_attempts)} />
                    <SupervisedSessionField label="Checkpoint Interval" value={String(activeSession.overnight_policy.checkpoint_interval_ticks)} />
                    <SupervisedSessionField label="Failure Count" value={String(activeSession.failure_count ?? 0)} />
                    <SupervisedSessionField label="Resume Status" value={activeSession.resume_state?.resume_status ?? "not_applicable"} />
                    <SupervisedSessionField label="Resumed From Checkpoint" value={activeSession.resume_state?.resumed_from_checkpoint_id ?? "none"} />
                    <SupervisedSessionField label="Preserved Reviews" value={String(activeSession.resume_state?.preserved_review_queue_count ?? 0)} />
                  </div>
                </article>
              ) : null}

              {latestCheckpoint ? (
                <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Latest Checkpoint</p>
                  <p className="mt-2 text-sm leading-7 body-muted">{latestCheckpoint.checkpoint_id}</p>
                  <p className="mt-2 text-xs leading-6 text-slate">Timestamp: {latestCheckpoint.timestamp}</p>
                  <p className="mt-1 text-xs leading-6 text-slate">Queued goals: {latestCheckpoint.queued_goals.length ? latestCheckpoint.queued_goals.join(", ") : "none"}</p>
                  <p className="mt-1 text-xs leading-6 text-slate">Completed goals: {latestCheckpoint.completed_goals.length ? latestCheckpoint.completed_goals.join(", ") : "none"}</p>
                </article>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard eyebrow="Overnight Queue" title="Overnight Review Queue">
            <div className="space-y-4">
              {activeSession?.review_queue?.length ? activeSession.review_queue.map((reviewItem) => (
                <ReviewQueueRow
                  key={reviewItem.review_id}
                  reviewId={reviewItem.review_id}
                  title={reviewItem.title}
                  summary={reviewItem.summary}
                  status={reviewItem.status}
                  severity={reviewItem.severity}
                  onApprove={() => handleAction({ type: "approve_review_item", review_id: reviewItem.review_id })}
                  onReject={() => handleAction({ type: "reject_review_item", review_id: reviewItem.review_id })}
                  onDefer={() => handleAction({ type: "defer_review_item", review_id: reviewItem.review_id })}
                  disabled={isPending}
                />
              )) : <p className="text-sm leading-7 body-muted">No overnight review items are queued.</p>}

              {activeSession?.active_recovery ? (
                <article className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Active Recovery</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge status={activeSession.active_recovery.selected_outcome} />
                  </div>
                  <p className="mt-3 text-sm leading-7 body-muted">{activeSession.active_recovery.summary}</p>
                  <p className="mt-2 text-xs text-slate">Recovery attempts: {activeSession.active_recovery.recovery_attempt_count}</p>
                </article>
              ) : null}
            </div>
          </SectionCard>
        </div>

        <SectionCard eyebrow="11" title="Execution Chains">
          <div className="space-y-4">
            {dashboardState?.execution_chains?.length ? dashboardState.execution_chains.slice().reverse().map((chain) => (
              <ExecutionChainRow key={chain.chain_id} chain={chain} />
            )) : <p className="text-sm leading-7 body-muted">No execution chains have been recorded yet.</p>}
          </div>
        </SectionCard>

        <SectionCard eyebrow="12" title="Runtime Timeline">
          <div className="space-y-4">
            {dashboardState?.runtime_observability?.event_log.length ? dashboardState.runtime_observability.event_log.slice().reverse().map((event) => (
              <article key={event.event_id} className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={event.status} />
                  <StatusBadge status={event.event_type} />
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">Tick {event.tick_index}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate">{event.timestamp}</p>
                </div>
                <p className="mt-3 text-sm leading-7 body-muted">{describeRuntimeEvent(event)}</p>
                {event.mutation_applied ? <p className="mt-2 text-sm leading-7 body-muted">Mutation: {event.mutation_applied}</p> : null}
                <p className="mt-2 text-xs leading-6 text-slate">Safety gate: {formatSafetyGateDecision(event.safety_gate_result)}</p>
                {event.scheduler_decision ? <p className="mt-2 text-xs leading-6 text-slate">Scheduler: {event.scheduler_decision}</p> : null}
                {event.next_scheduled_action ? <p className="mt-2 text-xs leading-6 text-slate">Next: {event.next_scheduled_action}</p> : null}
              </article>
            )) : <p className="text-sm leading-7 body-muted">No runtime events have been recorded yet.</p>}
          </div>
        </SectionCard>
          </>
        ) : null}
      </div>
    </main>
  );
}