import { NextResponse } from "next/server";

import { formatFreeAnalysis } from "@/lib/aie/format-result";
import { runAnalysis } from "@/lib/aie/run-analysis";
import type { AnalysisInput } from "@/lib/aie/types";

export const runtime = "nodejs";

function normalizePayload(value: unknown): AnalysisInput {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    problemDescription: String(source.problemDescription ?? "").trim(),
    codeSnippet: String(source.codeSnippet ?? "").trim(),
    errorMessage: String(source.errorMessage ?? "").trim(),
    context: String(source.context ?? "").trim(),
  };
}

export async function POST(request: Request) {
  try {
    const payload = normalizePayload(await request.json());

    if (!payload.problemDescription) {
      return NextResponse.json(
        { error: "Please describe the Unity issue before submitting." },
        { status: 400 },
      );
    }

    if (payload.problemDescription.length < 24) {
      return NextResponse.json(
        { error: "Please describe the Unity issue in a little more detail." },
        { status: 400 },
      );
    }

    const result = await runAnalysis(payload);
    return NextResponse.json(formatFreeAnalysis(result));
  } catch {
    return NextResponse.json(
      { error: "We couldn't generate an analysis right now. Please try again." },
      { status: 500 },
    );
  }
}