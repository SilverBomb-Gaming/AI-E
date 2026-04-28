"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import {
  applyOperatorControlAction,
  type OperatorControlAction,
  type SupervisedSessionControlInput,
} from "@/lib/aie/operatorControlSurface";
import type { AgentRuntimeNode } from "@/lib/aie/agentRuntimeRegistry";
import type {
  OperatorDashboardApprovalRequirement,
  OperatorDashboardBlockedGoal,
  OperatorDashboardGoal,
  OperatorDashboardRecoveryRecommendation,
  OperatorDashboardState,
  OperatorRuntimeObservabilityEvent,
} from "@/lib/aie/operatorDashboardState";
import type { ExecutionChainRecord } from "@/lib/aie/executionChainState";
import type { OperatorRuntimeStateProviderResult } from "@/lib/aie/operatorRuntimeStateContract";

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
  const [isPending, startTransition] = useTransition();

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
  const latestCheckpoint = dashboardState?.supervised_checkpoints?.slice(-1)[0] ?? null;
  const activeSession = dashboardState?.supervised_session ?? null;

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
              <p className="section-label">Operator Dashboard v0</p>
              <h1 className="headline text-4xl font-semibold text-ink lg:text-5xl">See runtime state, blockers, and operator actions in one surface.</h1>
              <p className="max-w-2xl text-base leading-8 body-muted">
                This minimal UI uses the dashboard-state read model plus a runtime state provider, safe action bridge, and runtime mutation executor to show what AI-E is doing, what is blocked, and what the operator can change next.
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
            <p className="text-xs uppercase tracking-[0.18em] text-slate">State Source: {getSourceLabel(providerResult.source)}</p>
            <p className="mt-2 text-sm leading-7 body-muted">{getSourceExplanation(providerResult)}</p>
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

          <SectionCard eyebrow="9" title="Supervised Autonomy Session">
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

          <SectionCard eyebrow="10" title="Overnight Autonomy">
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
      </div>
    </main>
  );
}