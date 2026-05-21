import type {
  ApprovalStateDisplay,
  GovernedLaneCardViewModel,
  GovernedOperationsDashboardViewModel,
  LaneStateDisplay,
  LaneStateDisplayVariant,
  VerificationStateDisplay,
} from "./governedOperationsDashboardModel";

// ---- Variant → Tailwind class maps ----

const LANE_STATE_PILL_CLASSES: Record<LaneStateDisplayVariant, string> = {
  neutral:  "border-ink/10 bg-white text-ink/60",
  active:   "border-ocean/20 bg-ocean/5 text-ocean",
  pending:  "border-amber-200 bg-amber-50 text-amber-700",
  success:  "border-emerald-200 bg-emerald-50 text-emerald-700",
  blocked:  "border-amber-200 bg-amber-50 text-amber-700",
  denied:   "border-coral/20 bg-coral/10 text-ember",
};

const APPROVAL_PILL_CLASSES: Record<ApprovalStateDisplay["variant"], string> = {
  neutral:  "border-ink/10 bg-white text-ink/60",
  pending:  "border-amber-200 bg-amber-50 text-amber-700",
  success:  "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-coral/20 bg-coral/10 text-ember",
};

const VERIFICATION_PILL_CLASSES: Record<VerificationStateDisplay["variant"], string> = {
  neutral:  "border-ink/10 bg-white text-ink/60",
  pending:  "border-ink/10 bg-mist/45 text-ink/60",
  success:  "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed:   "border-coral/20 bg-coral/10 text-ember",
  blocked:  "border-amber-200 bg-amber-50 text-amber-700",
};

// ---- Sub-components ----

function Pill({ label, className }: { label: string; className: string }) {
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.15em] ${className}`}>
      {label}
    </span>
  );
}

function SafetyBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-ocean/15 bg-ocean/5 px-2 py-0.5 text-xs font-mono text-ocean/80">
      {label}
    </span>
  );
}

function LaneStateSection({ display }: { display: LaneStateDisplay }) {
  return (
    <div className="flex items-center gap-2">
      <Pill label={display.label} className={LANE_STATE_PILL_CLASSES[display.variant]} />
      <span className="text-xs leading-5 body-muted">{display.description}</span>
    </div>
  );
}

function GovernedLaneCard({ lane }: { lane: GovernedLaneCardViewModel }) {
  return (
    <article className="rounded-[1.25rem] border border-ink/10 bg-white p-5 shadow-sm">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-label">{lane.runtime.label}</p>
          <p className="mt-0.5 text-xs font-mono text-ink/40">{lane.laneId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            label="execution-blocked"
            className="border-coral/20 bg-coral/10 text-ember"
          />
          <Pill
            label="dry-run"
            className="border-ocean/20 bg-ocean/5 text-ocean"
          />
        </div>
      </div>

      {/* Domain and sandbox */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm body-muted">
        <span className="font-semibold text-ink">{lane.runtime.domain}</span>
        <span className="rounded-[0.5rem] border border-ink/10 bg-mist/45 px-2 py-0.5 font-mono text-xs">{lane.sandboxId}</span>
      </div>

      {/* Lane state */}
      <div className="mt-4 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink/40">Lane State</p>
        <LaneStateSection display={lane.laneState} />
      </div>

      {/* Approval / Verification row */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink/40">Approval</p>
          <Pill label={lane.approvalState.label} className={APPROVAL_PILL_CLASSES[lane.approvalState.variant]} />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink/40">Verification</p>
          <Pill label={lane.verificationState.label} className={VERIFICATION_PILL_CLASSES[lane.verificationState.variant]} />
        </div>
      </div>

      {/* Operations / Dependencies / Transitions */}
      <div className="mt-4 flex flex-wrap gap-4 text-sm body-muted">
        <span><span className="font-semibold text-ink">{lane.operationCount}</span> operation{lane.operationCount !== 1 ? "s" : ""}</span>
        {lane.dependencyCount > 0 && (
          <span>
            <span className="font-semibold text-ink">{lane.unresolvedDependencyCount}/{lane.dependencyCount}</span> dep{lane.dependencyCount !== 1 ? "s" : ""} unresolved
          </span>
        )}
        <span><span className="font-semibold text-ink">{lane.transitionCount}</span> transition{lane.transitionCount !== 1 ? "s" : ""}</span>
      </div>

      {/* Last transition */}
      {lane.lastTransitionReason && (
        <div className="mt-3 rounded-[0.75rem] border border-ink/10 bg-mist/45 px-3 py-2 text-xs body-muted">
          <span className="font-semibold text-ink">Last:</span> {lane.lastTransitionReason}
          {lane.lastTransitionAt && <span className="ml-2 font-mono text-ink/30">{lane.lastTransitionAt}</span>}
        </div>
      )}

      {/* Capabilities */}
      {lane.capabilities.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink/40">Capabilities</p>
          <div className="flex flex-wrap gap-1.5">
            {lane.capabilities.map((cap) => (
              <span key={cap} className="rounded-full border border-ink/10 bg-mist/45 px-2 py-0.5 text-xs font-mono text-ink/60">
                {cap.replace(/_/g, "-")}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Safety badges */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {lane.safetyBadges.map((badge) => <SafetyBadge key={badge} label={badge} />)}
      </div>
    </article>
  );
}

function QueueSummaryRow({ vm }: { vm: GovernedOperationsDashboardViewModel }) {
  const counts = vm.summary.laneStateCounts.filter((c) => c.count > 0);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {counts.map((c) => (
        <span
          key={c.state}
          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${LANE_STATE_PILL_CLASSES[c.state === "denied" ? "denied" : c.state === "blocked" ? "blocked" : c.state === "ready" || c.state === "verified" || c.state === "completed" ? "success" : c.state === "approval_pending" ? "pending" : c.state === "validating" ? "active" : "neutral"]}`}
        >
          {c.count} {c.state.replace(/_/g, "-")}
        </span>
      ))}
      <Pill label={`${vm.totalLanes} total lanes`} className="border-ink/10 bg-white text-ink/60" />
    </div>
  );
}

// ---- Main dashboard component ----

type GovernedOperationsDashboardProps = {
  viewModel: GovernedOperationsDashboardViewModel;
};

export function GovernedOperationsDashboard({ viewModel }: GovernedOperationsDashboardProps) {
  return (
    <section aria-label="Governed Operations Dashboard">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-label">Governed Operations</p>
          <h2 className="mt-3 text-2xl font-semibold text-ink">Runtime Governance Dashboard</h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 body-muted">
            AI-E is the governance layer. Runtimes are assigned to bounded lanes.
            No runtime has been invoked. All operations remain in dry-run governance state.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill label="governance-only" className="border-ocean/20 bg-ocean/5 text-ocean" />
          <Pill label="all-execution-blocked" className="border-coral/20 bg-coral/10 text-ember" />
          <Pill label="dry-run-enforced" className="border-ocean/20 bg-ocean/5 text-ocean" />
        </div>
      </div>

      {/* Queue summary */}
      <div className="mt-5">
        <QueueSummaryRow vm={viewModel} />
      </div>

      {/* Governance note */}
      <div className="mt-4 rounded-[1rem] border border-ocean/15 bg-ocean/5 px-4 py-3 text-sm leading-7 text-ocean/90">
        <span className="font-semibold">Governance boundary: </span>{viewModel.governanceNote}
      </div>

      {/* Lane cards */}
      {viewModel.lanes.length === 0 ? (
        <div className="mt-6 rounded-[1rem] border border-ink/10 bg-mist/45 px-6 py-10 text-center text-sm body-muted">
          No operation lanes have been registered in this queue.
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {viewModel.lanes.map((lane) => (
            <GovernedLaneCard key={lane.laneId} lane={lane} />
          ))}
        </div>
      )}

      {/* Footer */}
      <p className="mt-6 text-xs font-mono body-muted">
        queue: {viewModel.queueId} · {viewModel.totalLanes} lane{viewModel.totalLanes !== 1 ? "s" : ""} registered · human approval required before any execution
      </p>
    </section>
  );
}
