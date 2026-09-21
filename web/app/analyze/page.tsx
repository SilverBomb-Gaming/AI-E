import { AnalysisForm } from "@/components/AnalysisForm";
import { SiteNav } from "@/components/SiteNav";

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
    <main className="page-shell mx-auto max-w-5xl px-6 pb-12 pt-0 lg:px-10">
      <SiteNav current="analyze" />
      <div className="pt-8">
        <AnalysisForm initialMode={entryMode} />
      </div>
    </main>
  );
}