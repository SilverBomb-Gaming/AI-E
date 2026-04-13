import Link from "next/link";

import { AnalysisForm } from "@/components/AnalysisForm";

export default function AnalyzePage() {
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
      <AnalysisForm />
    </main>
  );
}