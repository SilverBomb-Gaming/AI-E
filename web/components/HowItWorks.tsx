const steps = [
  {
    title: "User Intent",
    detail: "The operator describes the desired inspection, fix, validation, or workflow goal.",
  },
  {
    title: "AI-E Scopes",
    detail: "AI-E classifies risk, runtime boundaries, approval needs, and audit visibility before work begins.",
  },
  {
    title: "Runtime Plans",
    detail: "The system prepares an execution preview with affected files, commands, rollback notes, and expected impact.",
  },
  {
    title: "Human Approves",
    detail: "Mutation and execution wait for explicit operator authority. The preview is not execution.",
  },
  {
    title: "Execution Happens",
    detail: "A bounded local runtime applies the approved action when an executor is connected and permitted.",
  },
  {
    title: "Truth Is Reported",
    detail: "AI-E records receipts, validation status, rollback availability, and operational uncertainty.",
  },
];

export function HowItWorks() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 py-12 lg:px-10">
      <div className="max-w-3xl space-y-4">
        <p className="section-label">How it works</p>
        <h2 className="headline text-3xl font-semibold sm:text-4xl">From prompt to execution without losing the truth boundary.</h2>
      </div>
      <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, index) => (
          <article key={step.title} className="glass-card rounded-lg p-6 shadow-float">
            <div className="flex items-center gap-3">
              <span className="headline inline-flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-sm font-semibold text-white">
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