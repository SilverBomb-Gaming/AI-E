import Link from "next/link";

export default function UpgradePage() {
  return (
    <main className="page-shell mx-auto max-w-5xl px-6 py-8 lg:px-10 lg:py-12">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link href="/" className="text-sm font-semibold text-ocean">
          AI-E
        </Link>
        <Link href="/analyze" className="rounded-full border border-ink/10 px-4 py-2 text-sm font-semibold text-ink">
          Try free analysis
        </Link>
      </div>

      <section className="glass-card rounded-[2rem] p-8 shadow-float sm:p-10">
        <p className="section-label">Premium preview</p>
        <div className="mt-5 max-w-3xl space-y-4">
          <h1 className="headline text-4xl font-semibold sm:text-5xl">More than an answer: a structured path to the fix.</h1>
          <p className="text-base leading-8 body-muted">
            Premium is where AI-E moves from a free first-pass analysis into a deeper guided debugging surface with richer follow-up and saved context.
          </p>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <article className="rounded-[1.75rem] bg-white/75 p-6">
            <h2 className="headline text-2xl font-semibold">Free</h2>
            <ul className="mt-4 space-y-3 text-sm leading-7 body-muted">
              <li>One structured analysis</li>
              <li>Clear next-step fix guidance</li>
              <li>Fast product-value preview</li>
            </ul>
          </article>
          <article className="rounded-[1.75rem] bg-ink px-6 py-7 text-white">
            <h2 className="headline text-2xl font-semibold">Premium later</h2>
            <ul className="mt-4 space-y-3 text-sm leading-7 text-white/80">
              <li>Deeper workflow guidance</li>
              <li>Richer follow-up and issue breakdown</li>
              <li>Saved results and debugging history</li>
              <li>Structured exports and priority support path</li>
            </ul>
          </article>
        </div>

        <div className="mt-8 rounded-[1.75rem] bg-coral/10 p-6">
          <p className="section-label">Waitlist</p>
          <p className="mt-3 max-w-2xl text-sm leading-7 body-muted">
            Want access when guided debugging opens? Use the waitlist link below. Billing and account management stay intentionally lightweight in this milestone.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="mailto:hello@ai-e.app?subject=AI-E%20Premium%20Waitlist&body=I%20want%20to%20join%20the%20AI-E%20premium%20waitlist."
              className="rounded-full bg-coral px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-ember"
            >
              Join waitlist
            </a>
            <Link href="/analyze" className="rounded-full border border-ink/10 px-5 py-3 text-sm font-semibold text-ink">
              Back to free analysis
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}