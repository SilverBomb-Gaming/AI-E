import fs from "node:fs";
import path from "node:path";

export const metadata = {
  title: "AI-E Operational Manual",
};

const manualDocs = [
  { slug: "index", title: "Manual Home", fileName: "index.md" },
  { slug: "glossary", title: "Glossary", fileName: "glossary.md" },
  { slug: "ui-navigation", title: "UI Navigation", fileName: "ui-navigation.md" },
  { slug: "runtime-workflows", title: "Runtime Workflows", fileName: "runtime-workflows.md" },
  { slug: "ai-e-agents", title: "AI-E Agents", fileName: "ai-e-agents.md" },
  { slug: "real-vs-not-real", title: "REAL vs NOT REAL", fileName: "real-vs-not-real.md" },
];

function readManualDoc(fileName: string): string {
  const filePath = path.join(process.cwd(), "docs", "aie-manual", fileName);
  return fs.readFileSync(filePath, "utf8");
}

function extractHeading(content: string): string {
  const heading = content.split("\n").find((line) => line.startsWith("# "));
  return heading ? heading.replace(/^#\s+/, "").trim() : "AI-E Manual";
}

export default function OperatorManualPage() {
  const docs = manualDocs.map((doc) => {
    const content = readManualDoc(doc.fileName);
    return { ...doc, content, heading: extractHeading(content) };
  });

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-6 py-8 text-slate-950 dark:bg-[#070b12] dark:text-zinc-100">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-200">AI-E Manual System Phase 1</p>
          <h1 className="mt-2 text-3xl font-semibold">Operational Manual and Translation System</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-zinc-300">
            A read-only manual browser for AI-E product comprehension: engineering terms, creator-friendly translation, operator navigation, runtime workflows, agent behavior, and official truth boundaries.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <nav className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#0d1420] lg:sticky lg:top-6 lg:self-start">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-zinc-400">Manual Sections</h2>
            <ol className="mt-4 space-y-2">
              {docs.map((doc) => (
                <li key={doc.slug}>
                  <a href={`#${doc.slug}`} className="block rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-cyan-300/60 dark:hover:bg-cyan-400/10">
                    {doc.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="space-y-6">
            {docs.map((doc) => (
              <article key={doc.slug} id={doc.slug} className="scroll-mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#0d1420]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-white/10">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-200">{doc.fileName}</p>
                    <h2 className="mt-1 text-2xl font-semibold">{doc.heading}</h2>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">Markdown Source</span>
                </div>
                <pre className="mt-5 whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700 dark:border-white/10 dark:bg-[#070b12] dark:text-zinc-300">
                  {doc.content}
                </pre>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
