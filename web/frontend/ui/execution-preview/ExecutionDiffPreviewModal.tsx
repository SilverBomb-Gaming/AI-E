import type { ExecutionDiffPreviewPlan } from "./executionDiffPreviewModel";

type ExecutionDiffPreviewModalProps = {
  open: boolean;
  plan: ExecutionDiffPreviewPlan;
  approvalGranted: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
};

export function ExecutionDiffPreviewModal({
  open,
  plan,
  approvalGranted,
  onClose,
  onApprove,
  onReject,
}: ExecutionDiffPreviewModalProps) {
  if (!open) {
    return null;
  }

  const riskClassName = plan.riskLevel === "high"
    ? "border-coral/20 bg-coral/10 text-ember"
    : plan.riskLevel === "medium"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-4 py-6"
      role="presentation"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.6)", zIndex: 2147483000 }}
    >
      <section
        aria-labelledby="execution-diff-preview-title"
        aria-modal="true"
        className="relative w-full max-w-4xl overflow-y-auto rounded-[1.25rem] border border-ink/10 bg-white p-6 shadow-float"
        role="dialog"
        style={{ backgroundColor: "#ffffff", maxHeight: "92vh", zIndex: 2147483001 }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-label">Execution Diff Preview</p>
            <h2 id="execution-diff-preview-title" className="mt-3 text-2xl font-semibold text-ink">{plan.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 body-muted">{plan.summary}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
          >
            Close
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${riskClassName}`}>{plan.riskLevel}-risk</span>
          <span className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-ink/70">{plan.action}</span>
          <span className="rounded-full border border-ocean/20 bg-ocean/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-ocean">dry-run-preview</span>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${approvalGranted ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
            {approvalGranted ? "approval-visible" : "approval-required"}
          </span>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <PreviewList title="Planned Mutations" values={plan.plannedMutations} />
          <PreviewList title="Affected Files" values={plan.affectedFiles} mono />
          <PreviewList title="Execution Boundary" values={plan.commands} />
          <PreviewList
            title="Rollback And Approval"
            values={[
              `Approval required: ${plan.approvalRequired ? "yes" : "no"}`,
              `Rollback available after execution: ${plan.rollbackAvailable ? "yes" : "no"}`,
              `Modal applies mutations: ${plan.dryRunOnly ? "no" : "yes"}`,
            ]}
          />
        </div>

        {plan.warnings.length ? (
          <div className="mt-5 rounded-[1rem] border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-800">
            <p className="font-semibold text-ink">Operator Warnings</p>
            <ul className="mt-2 space-y-1">
              {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-ink/10 pt-5">
          <button
            type="button"
            onClick={onReject}
            className="rounded-full border border-coral/20 bg-coral/10 px-5 py-3 text-sm font-semibold text-ember transition hover:-translate-y-0.5"
          >
            Reject Preview
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="rounded-full border border-ocean/20 bg-ocean px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
          >
            Approve Preview
          </button>
        </div>
      </section>
    </div>
  );
}

function PreviewList({ title, values, mono = false }: { title: string; values: string[]; mono?: boolean }) {
  return (
    <article className="rounded-[1rem] border border-ink/10 bg-mist/45 p-4 text-sm leading-7 body-muted">
      <p className="font-semibold text-ink">{title}</p>
      <ul className="mt-3 space-y-2">
        {values.map((value) => (
          <li key={value} className={`rounded-[0.75rem] border border-ink/10 bg-white px-3 py-2 ${mono ? "break-words font-mono text-xs" : ""}`}>{value}</li>
        ))}
      </ul>
    </article>
  );
}