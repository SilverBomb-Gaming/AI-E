import Link from "next/link";

type UpgradeCardProps = {
  compact?: boolean;
};

export function UpgradeCard({ compact = false }: UpgradeCardProps) {
  return (
    <aside className="glass-card rounded-lg border border-ocean/15 p-6 shadow-float sm:p-8">
      <p className="section-label">Tiers</p>
      <div className="mt-4 space-y-4">
        <h3 className="headline text-2xl font-semibold">Simple public positioning now, deeper operational packaging later.</h3>
        <p className="text-sm leading-7 body-muted">
          AI-E does not need hosted inference or a cloud execution backend to prove the product. The public website builds visibility while the local app remains the serious operational environment.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-ink/10 bg-white p-4">
            <h4 className="font-semibold text-ink">Free</h4>
            <p className="mt-2 text-sm leading-6 body-muted">Governed AI workspace for safer, clearer AI-assisted work.</p>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white p-4">
            <h4 className="font-semibold text-ink">Operator</h4>
            <p className="mt-2 text-sm leading-6 body-muted">Governed workflow execution with previews, approvals, and receipts.</p>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white p-4">
            <h4 className="font-semibold text-ink">Studio / Pro</h4>
            <p className="mt-2 text-sm leading-6 body-muted">AI operational infrastructure for teams and production workflows.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/upgrade"
            className="rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate"
          >
            View roadmap
          </Link>
          {!compact ? (
            <a
              href="mailto:hello@ai-e.app?subject=AI-E%20Waitlist"
              className="rounded-lg border border-ink/10 px-5 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
            >
              Join waitlist
            </a>
          ) : null}
        </div>
      </div>
    </aside>
  );
}