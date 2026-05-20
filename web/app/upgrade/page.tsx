import Link from "next/link";

export default function UpgradePage() {
  return (
    <main className="page-shell mx-auto max-w-5xl px-6 py-8 lg:px-10 lg:py-12">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link href="/" className="text-sm font-semibold text-ocean">
          AI-E
        </Link>
        <Link href="/operator/preview" className="rounded-lg border border-ink/10 px-4 py-2 text-sm font-semibold text-ink">
          View demo
        </Link>
      </div>

      <section className="glass-card rounded-lg p-8 shadow-float sm:p-10">
        <p className="section-label">Roadmap and access</p>
        <div className="mt-5 max-w-3xl space-y-4">
          <h1 className="headline text-4xl font-semibold sm:text-5xl">A local-first operational app with a public-facing launch path.</h1>
          <p className="text-base leading-8 body-muted">
            AI-E starts with public visibility and a free local workspace, then expands into operator-grade execution features, studio workflows, and optional hybrid infrastructure.
          </p>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <article className="rounded-lg bg-white p-6">
            <h2 className="headline text-2xl font-semibold">Free</h2>
            <ul className="mt-4 space-y-3 text-sm leading-7 body-muted">
              <li>Governed AI workspace</li>
              <li>Clear truth boundaries</li>
              <li>Local-first setup path</li>
            </ul>
          </article>
          <article className="rounded-lg bg-ink px-6 py-7 text-white">
            <h2 className="headline text-2xl font-semibold">Operator</h2>
            <ul className="mt-4 space-y-3 text-sm leading-7 text-white/80">
              <li>Execution previews</li>
              <li>Approval workflows</li>
              <li>Mutation receipts</li>
              <li>Rollback awareness</li>
            </ul>
          </article>
          <article className="rounded-lg bg-white p-6">
            <h2 className="headline text-2xl font-semibold">Studio / Pro</h2>
            <ul className="mt-4 space-y-3 text-sm leading-7 body-muted">
              <li>Team orchestration</li>
              <li>Workflow replay/history</li>
              <li>Production governance surfaces</li>
            </ul>
          </article>
        </div>

        <div className="mt-8 rounded-lg bg-ocean/10 p-6">
          <p className="section-label">Waitlist</p>
          <p className="mt-3 max-w-2xl text-sm leading-7 body-muted">
            Join the waitlist for preview builds, demo updates, and operator-tier access. Billing and hosted execution stay intentionally out of scope for this milestone.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="mailto:hello@ai-e.app?subject=AI-E%20Preview%20Waitlist&body=I%20want%20to%20join%20the%20AI-E%20preview%20waitlist."
              className="rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate"
            >
              Join waitlist
            </a>
            <Link href="/" className="rounded-lg border border-ink/10 px-5 py-3 text-sm font-semibold text-ink">
              Back to public site
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}