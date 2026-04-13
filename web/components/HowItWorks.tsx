const steps = [
  {
    title: "Paste your issue",
    detail: "Drop in the Unity blocker, error message, or scene context without building a giant form.",
  },
  {
    title: "AI-E analyzes what happened",
    detail: "The free pass turns your issue into a structured read on the likely fault line and the important signals.",
  },
  {
    title: "Get a clear next-step plan",
    detail: "Leave with a bounded list of checks and fixes instead of another round of guesswork.",
  },
];

export function HowItWorks() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 py-12 lg:px-10">
      <div className="max-w-2xl space-y-4">
        <p className="section-label">How it works</p>
        <h2 className="headline text-3xl font-semibold sm:text-4xl">Three steps from blocker to plan.</h2>
      </div>
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {steps.map((step, index) => (
          <article key={step.title} className="glass-card rounded-[1.5rem] p-6 shadow-float">
            <div className="flex items-center gap-3">
              <span className="headline inline-flex h-10 w-10 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
                0{index + 1}
              </span>
              <h3 className="headline text-xl font-semibold">{step.title}</h3>
            </div>
            <p className="mt-4 text-sm leading-7 body-muted">{step.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}