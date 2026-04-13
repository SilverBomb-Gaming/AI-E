import Link from "next/link";

export function Hero() {
  return (
    <section className="relative z-10 mx-auto flex max-w-6xl flex-col gap-10 px-6 pb-12 pt-8 lg:flex-row lg:items-end lg:justify-between lg:px-10 lg:pb-16 lg:pt-14">
      <div className="max-w-3xl space-y-6">
        <p className="section-label">AI-E Web Front Door v0</p>
        <div className="space-y-5">
          <h1 className="headline text-5xl font-semibold leading-[0.94] text-ink sm:text-6xl lg:text-7xl">
            Paste your Unity issue. Get a step-by-step fix plan.
          </h1>
          <p className="max-w-2xl text-lg leading-8 body-muted sm:text-xl">
            AI-E turns your bug or blocker into a clear analysis: what happened, what matters, and what to do next.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/analyze"
            className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate"
          >
            Try Free Analysis
          </Link>
          <a
            href="#example"
            className="rounded-full border border-ink/10 bg-white/70 px-6 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
          >
            See Example
          </a>
          <Link
            href="/upgrade"
            className="rounded-full border border-coral/25 bg-coral/10 px-6 py-3 text-sm font-semibold text-ember transition hover:-translate-y-0.5"
          >
            Get Started
          </Link>
        </div>
      </div>
      <div className="glass-card max-w-md rounded-[2rem] p-6 shadow-float">
        <p className="section-label">Why AI-E</p>
        <div className="mt-4 space-y-4">
          <div>
            <h2 className="headline text-2xl font-semibold">Stop guessing.</h2>
            <p className="mt-2 text-sm leading-7 body-muted">
              Use AI-E when generic AI advice is not enough. The free pass gives you a structured first read instead of a vague answer dump.
            </p>
          </div>
          <ul className="space-y-3 text-sm body-muted">
            <li>What happened</li>
            <li>What matters most</li>
            <li>What to do next, in order</li>
          </ul>
        </div>
      </div>
    </section>
  );
}