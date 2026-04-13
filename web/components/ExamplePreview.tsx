const matters = [
  "The stack trace points at a prefab reference path that is missing at runtime.",
  "The issue is reproducible only after scene load, which suggests an initialization order problem.",
  "Broad refactors are unnecessary until the serialized dependency path is validated.",
];

const nextSteps = [
  "Open the prefab or scene root that owns the missing reference and inspect serialized fields.",
  "Reproduce the load path in the smallest possible scene to confirm whether instantiation order is the trigger.",
  "Validate one bounded fix, then rerun before touching adjacent systems.",
];

export function ExamplePreview() {
  return (
    <section id="example" className="relative z-10 mx-auto max-w-6xl px-6 py-12 lg:px-10">
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div className="space-y-4">
          <p className="section-label">Example output</p>
          <h2 className="headline text-3xl font-semibold sm:text-4xl">What the free analysis should feel like.</h2>
          <p className="text-base leading-8 body-muted">
            This is the core product moment: one concise explanation, the highest-signal findings, and an ordered list of next steps.
          </p>
        </div>
        <div className="glass-card rounded-[2rem] p-6 shadow-float sm:p-8">
          <div className="grid gap-6">
            <section className="rounded-[1.5rem] bg-white/70 p-5">
              <p className="section-label">What happened</p>
              <p className="mt-3 text-sm leading-7 text-ink/90">
                AI-E sees a likely runtime reference issue: a scene or prefab dependency is missing when the load path completes, so the error appears after play-mode startup rather than at compile time.
              </p>
            </section>
            <section className="rounded-[1.5rem] bg-white/70 p-5">
              <p className="section-label">What matters</p>
              <ul className="mt-3 space-y-3 text-sm leading-7 text-ink/90">
                {matters.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
            <section className="rounded-[1.5rem] bg-white/70 p-5">
              <p className="section-label">What to do next</p>
              <ol className="mt-3 space-y-3 text-sm leading-7 text-ink/90">
                {nextSteps.map((item, index) => (
                  <li key={item}>{index + 1}. {item}</li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}