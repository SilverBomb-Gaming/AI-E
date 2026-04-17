import Link from "next/link";

import { AnalysisForm } from "@/components/AnalysisForm";

type AnalyzePageProps = {
  searchParams?: {
    mode?: string | string[];
  };
};

function resolveEntryMode(mode: string | string[] | undefined): "fresh" | "continue" {
  const normalizedMode = Array.isArray(mode) ? mode[0] : mode;
  return normalizedMode === "continue" ? "continue" : "fresh";
}

export default function AnalyzePage({ searchParams }: AnalyzePageProps) {
  const entryMode = resolveEntryMode(searchParams?.mode);

  return (
    <main className="page-shell mx-auto max-w-5xl px-6 py-8 lg:px-10 lg:py-12">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link href="/" className="text-sm font-semibold text-ocean">
          AI-E
        </Link>
        <Link href="/upgrade" className="rounded-full border border-ink/10 px-4 py-2 text-sm font-semibold text-ink">
          Premium preview
        </Link>
      </div>
      <AnalysisForm initialMode={entryMode} />
    </main>
  );
}