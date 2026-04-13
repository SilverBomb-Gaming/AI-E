import Link from "next/link";

type UpgradeCardProps = {
  compact?: boolean;
};

export function UpgradeCard({ compact = false }: UpgradeCardProps) {
  return (
    <aside className="glass-card rounded-[2rem] border border-coral/20 p-6 shadow-float sm:p-8">
      <p className="section-label">Premium path</p>
      <div className="mt-4 space-y-4">
        <h3 className="headline text-2xl font-semibold">Need a deeper workflow breakdown?</h3>
        <p className="text-sm leading-7 body-muted">
          Unlock guided debugging, richer follow-up, saved results, and a more detailed issue breakdown when the free pass shows you the right direction but you need more structure.
        </p>
        <ul className="space-y-2 text-sm body-muted">
          <li>Deeper guided workflow</li>
          <li>Persistent history and saved results</li>
          <li>Richer follow-up and structured exports</li>
        </ul>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/upgrade"
            className="rounded-full bg-coral px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-ember"
          >
            Unlock guided debugging
          </Link>
          {!compact ? (
            <a
              href="mailto:hello@ai-e.app?subject=AI-E%20Premium%20Interest"
              className="rounded-full border border-ink/10 px-5 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
            >
              Join waitlist
            </a>
          ) : null}
        </div>
      </div>
    </aside>
  );
}