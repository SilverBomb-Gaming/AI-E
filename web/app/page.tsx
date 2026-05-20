import { ExamplePreview } from "@/components/ExamplePreview";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { UpgradeCard } from "@/components/UpgradeCard";

const deploymentLayers = [
  ["Marketing / portfolio", "Web"],
  ["Core AI-E runtime app", "Local desktop"],
  ["Future team orchestration", "Hybrid"],
  ["Enterprise later", "Optional cloud"],
] as const;

const roadmap = [
  "Public portfolio website",
  "Free downloadable local AI-E build",
  "Operator subscription features",
  "Hybrid orchestration and team systems",
  "Enterprise governance infrastructure",
] as const;

export default function HomePage() {
  return (
    <main className="page-shell">
      <Hero />
      <HowItWorks />
      <ExamplePreview />
      <section className="site-band relative z-10 mx-auto max-w-6xl px-6 py-14 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div className="space-y-4">
            <p className="section-label">Deployment strategy</p>
            <h2 className="headline text-3xl font-semibold sm:text-4xl">Public visibility and full operational execution stay separate.</h2>
            <p className="text-base leading-8 body-muted">
              The website demonstrates legitimacy, mission, roadmap, screenshots, waitlist interest, and future monetization. The local app remains the place for governed execution, local runtimes, safe file operations, approvals, and rollback awareness.
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border border-ink/10 bg-white shadow-float">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-ink text-white">
                <tr>
                  <th className="px-5 py-4 font-semibold">Layer</th>
                  <th className="px-5 py-4 font-semibold">Deployment</th>
                </tr>
              </thead>
              <tbody>
                {deploymentLayers.map(([layer, deployment]) => (
                  <tr key={layer} className="border-t border-ink/10">
                    <td className="px-5 py-4 font-semibold text-ink">{layer}</td>
                    <td className="px-5 py-4 body-muted">{deployment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="site-band relative z-10 mx-auto max-w-6xl px-6 py-14 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="console-panel rounded-lg p-6 shadow-float">
            <p className="section-label text-white/70">Demo video</p>
            <h2 className="headline mt-4 text-3xl font-semibold text-white">Show the governance flow, not a generic chatbot.</h2>
            <div className="mt-6 aspect-video rounded-lg border border-white/15 bg-white/8 p-5">
              <div className="flex h-full flex-col justify-between">
                <div className="grid gap-3 text-sm text-white/80 sm:grid-cols-2">
                  <span>Runtime validation</span>
                  <span>Approval queue</span>
                  <span>Execution preview</span>
                  <span>Truth lines</span>
                </div>
                <p className="text-sm leading-7 text-white/70">
                  Placeholder for the first product demo video: local runtime readiness, execution preview, operator approval, bounded action, receipt, and operational truth update.
                </p>
              </div>
            </div>
          </div>
          <div className="glass-card rounded-lg p-6 shadow-float">
            <p className="section-label">MVP path</p>
            <h2 className="headline mt-4 text-3xl font-semibold">Win operational trust before chasing cloud scale.</h2>
            <ol className="mt-6 space-y-4 text-sm leading-7 body-muted">
              {roadmap.map((item, index) => (
                <li key={item} className="flex gap-3">
                  <span className="headline flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ocean text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-16 pt-6 lg:px-10">
        <UpgradeCard />
      </section>
    </main>
  );
}