import Image from "next/image";
import Link from "next/link";

import operatorScreenshot from "../error.png";

export function Hero() {
  return (
    <section className="relative z-10 mx-auto grid max-w-6xl gap-10 px-6 pb-12 pt-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:px-10 lg:pb-16 lg:pt-14">
      <div className="max-w-3xl space-y-6">
        <p className="section-label">AI-E Public Website</p>
        <div className="space-y-5">
          <h1 className="headline text-5xl font-semibold leading-none text-ink sm:text-6xl lg:text-7xl">
            AI-E
            <span className="block text-ocean">Governed AI Operations For Serious Builders.</span>
          </h1>
          <p className="max-w-2xl text-lg leading-8 body-muted sm:text-xl">
            AI-E helps creators and operators use AI safely through scoped workflows, execution previews, approval systems, rollback awareness, and audit-visible operational truth.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/operator/preview"
            className="rounded-lg bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate"
          >
            View Demo
          </Link>
          <a
            href="mailto:hello@ai-e.app?subject=AI-E%20Waitlist&body=I%20want%20to%20join%20the%20AI-E%20waitlist."
            className="rounded-lg border border-ink/10 bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
          >
            Join Waitlist
          </a>
          <Link
            href="/upgrade"
            className="rounded-lg border border-ocean/20 bg-ocean/10 px-6 py-3 text-sm font-semibold text-ocean transition hover:-translate-y-0.5"
          >
            Download Preview Build
          </Link>
        </div>
      </div>
      <div className="space-y-4">
        <div className="overflow-hidden rounded-lg border border-ink/10 bg-white shadow-float">
          <Image
            src={operatorScreenshot}
            alt="AI-E governed operator session showing approval, bounded execution, and operational receipt details."
            className="h-auto w-full"
            priority
          />
        </div>
        <div className="console-panel rounded-lg p-5">
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="font-semibold text-white">Truth Line</p>
              <p className="mt-1 text-white/70">Mutation Not Applied until approved.</p>
            </div>
            <div>
              <p className="font-semibold text-white">Runtime Boundary</p>
              <p className="mt-1 text-white/70">Local-first execution stays visible.</p>
            </div>
            <div>
              <p className="font-semibold text-white">Receipt</p>
              <p className="mt-1 text-white/70">Audit evidence follows the action.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}