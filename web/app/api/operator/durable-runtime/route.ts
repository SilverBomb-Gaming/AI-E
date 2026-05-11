import path from "node:path";
import { NextResponse } from "next/server";

import { createFileBackedDurableProjectMemoryStore } from "@/lib/aie/durableProjectMemoryStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const trustedWebRoot = process.cwd();
  const trustedRepoRoot = path.resolve(trustedWebRoot, "..");
  const store = createFileBackedDurableProjectMemoryStore({
    storageRoot: path.join(trustedRepoRoot, ".aie", "durable_project_memory"),
    projectId: typeof body.projectId === "string" ? body.projectId : "AI-E",
  });
  const report = await store.restoreRuntimeContinuity();
  return NextResponse.json({ report });
}