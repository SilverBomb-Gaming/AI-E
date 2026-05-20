const differences = [
  "Truth lines separate planning, approval, execution, validation, and deployment state.",
  "Execution previews show proposed mutations before anything touches the runtime.",
  "Approval cards keep human authority visible instead of burying it in agent text.",
  "Receipts preserve what actually happened, including uncertainty and blocked execution.",
];

const localFirst = [
  "Projects, models, workflow state, and runtime data stay local by default.",
  "Ollama and local runtime support avoid unnecessary hosted inference cost.",
  "File boundaries are clearer when execution happens beside the operator's workspace.",
  "Hybrid orchestration can arrive later without forcing the core app into the cloud.",
];

export function ExamplePreview() {
  return (
    <section id="demo" className="site-band relative z-10 mx-auto max-w-6xl px-6 py-14 lg:px-10">
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div className="space-y-4">
          <p className="section-label">What makes AI-E different</p>
          <h2 className="headline text-3xl font-semibold sm:text-4xl">A governance layer above AI systems, not another model race.</h2>
          <p className="text-base leading-8 body-muted">
            The public website explains the product. The local desktop app is where governed execution, file access, runtime routing, approvals, and receipts actually happen.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <section className="glass-card rounded-lg p-6 shadow-float">
            <p className="section-label">Against black-box agents</p>
            <ul className="mt-4 space-y-3 text-sm leading-7 text-ink/90">
              {differences.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section className="glass-card rounded-lg p-6 shadow-float">
            <p className="section-label">Local-first advantages</p>
            <ul className="mt-4 space-y-3 text-sm leading-7 text-ink/90">
              {localFirst.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </section>
  );
}