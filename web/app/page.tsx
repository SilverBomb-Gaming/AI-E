import { DemoChat } from "@/components/DemoChat";
import { SiteNav } from "@/components/SiteNav";

const scopeItems = [
  {
    title: "What this demo is",
    detail:
      "A public spine: chat, one real planner tool, and an honest demo mode that works without private keys.",
  },
  {
    title: "What the tool does",
    detail:
      "`plan_bounded_request` parses a game-dev ask, applies constraint rules, and returns a review-gated plan. It can also block.",
  },
  {
    title: "What this demo is not",
    detail:
      "Not the Windows operator console, not Unity scene mutation, not Telegram control, and not a full local agent runtime.",
  },
];

export default function HomePage() {
  return (
    <main className="page-shell pb-16">
      <SiteNav current="demo" />
      <section className="relative z-10 mx-auto grid max-w-6xl gap-10 px-6 pb-8 pt-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:px-10 lg:pt-12">
        <div className="space-y-6">
          <p className="section-label">AI-E public spine</p>
          <h1 className="headline text-5xl font-semibold leading-[0.94] text-ink sm:text-6xl">
            Bounded plans for game-dev requests. No fake magic.
          </h1>
          <p className="max-w-xl text-lg leading-8 body-muted">
            AI-E turns messy intent into a reviewable plan with guardrails. This page is the shipped public proof:
            a working chat UI and a real agent tool you can watch run.
          </p>
          <ol className="space-y-3 text-sm leading-7 text-ink/90">
            <li>1. Click a suggested prompt, or type your own request.</li>
            <li>2. Watch `plan_bounded_request` run and return a status, steps, and blocks.</li>
            <li>3. Notice what it refuses: unsupported engines, scene mutation, autonomous shipping.</li>
          </ol>
        </div>
        <DemoChat />
      </section>
      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-4 lg:px-10">
        <div className="grid gap-5 md:grid-cols-3">
          {scopeItems.map((item) => (
            <article key={item.title} className="glass-card rounded-[1.5rem] p-6 shadow-float">
              <h2 className="headline text-xl font-semibold">{item.title}</h2>
              <p className="mt-3 text-sm leading-7 body-muted">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
